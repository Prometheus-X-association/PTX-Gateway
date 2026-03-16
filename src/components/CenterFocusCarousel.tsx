import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowLeft, ArrowRight, Globe, User, Settings, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useProcessSession } from "@/contexts/ProcessSessionContext";
import { ResourceParameter, getParamValuesMap } from "@/types/dataspace";
import { isSessionIdPlaceholder, resolveParamValue } from "@/utils/paramSanitizer";

interface CarouselItem {
  id: string;
  name: string;
  provider: string;
  description: string;
  queryParams: string[];
  contract: string;
  parameters: ResourceParameter[]; // Database parameters for prefilling
}

interface CenterFocusCarouselProps {
  items: CarouselItem[];
  selectedIds: string[];
  onSelect?: (item: CarouselItem) => void;
  onParamsChange: (itemId: string, params: Record<string, string>) => void;
  params: Record<string, Record<string, string>>;
  isDebugMode?: boolean;
  disableDeselect?: boolean;
}

const CenterFocusCarousel = ({
  items,
  selectedIds,
  onSelect,
  onParamsChange,
  params,
  isDebugMode = false,
  disableDeselect = false,
}: CenterFocusCarouselProps) => {
  const { sessionId } = useProcessSession();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [paramsDialog, setParamsDialog] = useState<{ open: boolean; item: CarouselItem | null }>({
    open: false,
    item: null,
  });
  const [descriptionDialog, setDescriptionDialog] = useState<{ open: boolean; title: string; description: string }>({
    open: false,
    title: "",
    description: "",
  });

  // Truncation detection
  const descriptionRefs = useRef<Map<string, HTMLParagraphElement>>(new Map());
  const [truncatedItems, setTruncatedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    const checkTruncation = () => {
      const newTruncated = new Set<string>();
      descriptionRefs.current.forEach((el, id) => {
        if (el && el.scrollHeight > el.clientHeight) {
          newTruncated.add(id);
        }
      });
      setTruncatedItems(newTruncated);
    };

    const timer = setTimeout(checkTruncation, 200);
    window.addEventListener("resize", checkTruncation);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", checkTruncation);
    };
  }, [items, activeIndex]);

  const setDescriptionRef = (id: string) => (el: HTMLParagraphElement | null) => {
    if (el) {
      descriptionRefs.current.set(id, el);
    } else {
      descriptionRefs.current.delete(id);
    }
  };

  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex < items.length - 1;

  const navigate = useCallback((newIndex: number) => {
    if (newIndex === activeIndex || isAnimating || newIndex < 0 || newIndex >= items.length) return;
    setIsAnimating(true);
    setActiveIndex(newIndex);
    setTimeout(() => setIsAnimating(false), 700);
  }, [activeIndex, isAnimating, items.length]);

  const goToPrev = () => canGoPrev && navigate(activeIndex - 1);
  const goToNext = () => canGoNext && navigate(activeIndex + 1);

  // Get pre-filled params from database parameters, resolving session ID placeholders
  const getPrefillParamsFromDatabase = useCallback((item: CarouselItem): Record<string, string> => {
    const paramValues = getParamValuesMap(item.parameters);
    const resolvedParams: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(paramValues)) {
      if (isSessionIdPlaceholder(value)) {
        resolvedParams[key] = sessionId;
      } else {
        resolvedParams[key] = value;
      }
    }
    
    return resolvedParams;
  }, [sessionId]);

  const handleItemClick = (item: CarouselItem, index: number) => {
    if (index < activeIndex) {
      goToPrev();
    } else if (index > activeIndex) {
      goToNext();
    } else {
      // Center item - toggle selection
      const isCurrentlySelected = selectedIds.includes(item.id);
      const hasParams = item.queryParams && item.queryParams.length > 0;

      if (!isCurrentlySelected) {
        // Pre-fill params from database when selecting
        if (hasParams) {
          const prefillParams = getPrefillParamsFromDatabase(item);
          onParamsChange(item.id, prefillParams);
        }
        if (onSelect) {
          onSelect(item);
        }
        // Only show params dialog in debug mode
        if (isDebugMode && hasParams) {
          setParamsDialog({ open: true, item });
        }
      } else if (!disableDeselect && onSelect) {
        // Deselecting - just call onSelect to toggle off (unless disabled)
        onSelect(item);
      } else if (isDebugMode && hasParams) {
        // If deselect is disabled, still allow opening params dialog
        setParamsDialog({ open: true, item });
      }
    }
  };

  const openDescriptionDialog = (e: React.MouseEvent, title: string, description: string) => {
    e.stopPropagation();
    setDescriptionDialog({ open: true, title, description });
  };

  const closeParamsDialog = () => {
    setParamsDialog({ open: false, item: null });
  };

  const updateParam = (paramId: string, value: string) => {
    if (paramsDialog.item) {
      const currentParams = params[paramsDialog.item.id] || {};
      onParamsChange(paramsDialog.item.id, { ...currentParams, [paramId]: value });
    }
  };

  if (items.length === 0) {
    return (
      <div className="glass-card p-6 text-center">
        <p className="text-muted-foreground text-sm">No API data resources available</p>
      </div>
    );
  }

  // Get responsive spacing based on screen width
  const getResponsiveSpacing = () => {
    if (typeof window === 'undefined') return 220;
    const width = window.innerWidth;
    if (width < 640) return 160; // sm
    if (width < 768) return 200; // md
    if (width < 1024) return 240; // lg
    if (width < 1280) return 280; // xl
    return 300; // 2xl+
  };

  // Calculate continuous transform for each item
  const getItemTransform = (index: number) => {
    const offset = index - activeIndex;
    const spacing = getResponsiveSpacing();
    
    // Positioning
    const xOffset = offset * spacing; // Responsive horizontal spacing
    const zOffset = -Math.abs(offset) * 100; // Depth - items further away go back
    const rotateY = offset * 25; // Book page rotation
    
    // Scale based on distance
    const scale = Math.max(0.6, 1 - Math.abs(offset) * 0.2);
    
    // Opacity based on distance
    const opacity = Math.max(0.3, 1 - Math.abs(offset) * 0.4);

    return {
      transform: `translateX(${xOffset}px) translateZ(${zOffset}px) rotateY(${rotateY}deg) scale(${scale})`,
      opacity,
      zIndex: 10 - Math.abs(offset),
    };
  };

  return (
    <div className="relative py-8">
      {/* Navigation Arrows */}
      <button
        onClick={goToPrev}
        disabled={!canGoPrev || isAnimating}
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-50 w-12 h-12 rounded-full bg-background/95 border border-border flex items-center justify-center shadow-xl backdrop-blur-sm transition-all duration-300 ${
          canGoPrev 
            ? "hover:bg-accent hover:border-primary/50 hover:scale-110 cursor-pointer" 
            : "opacity-30 cursor-not-allowed"
        }`}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <button
        onClick={goToNext}
        disabled={!canGoNext || isAnimating}
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-50 w-12 h-12 rounded-full bg-background/95 border border-border flex items-center justify-center shadow-xl backdrop-blur-sm transition-all duration-300 ${
          canGoNext 
            ? "hover:bg-accent hover:border-primary/50 hover:scale-110 cursor-pointer" 
            : "opacity-30 cursor-not-allowed"
        }`}
      >
        <ArrowRight className="w-5 h-5" />
      </button>

      {/* 3D Carousel Stage */}
      <div 
        className="relative h-72 mx-4 sm:mx-8 md:mx-12 lg:mx-16 flex items-center justify-center overflow-hidden"
        style={{ 
          perspective: '1200px',
          perspectiveOrigin: 'center center'
        }}
      >
        {/* Carousel Track */}
        <div 
          className="relative w-full h-full flex items-center justify-center"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {items.map((item, index) => {
            const isSelected = selectedIds.includes(item.id);
            const hasParams = item.queryParams && item.queryParams.length > 0;
            const isCenter = index === activeIndex;
            const distance = Math.abs(index - activeIndex);
            
            // Only render items within visible range
            if (distance > 2) return null;

            const { transform, opacity, zIndex } = getItemTransform(index);

            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item, index)}
                className={`
                  absolute cursor-pointer overflow-hidden
                  rounded-xl border bg-card/95 backdrop-blur-xl
                  transition-all duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]
                  ${isCenter 
                    ? 'w-[280px] sm:w-[360px] md:w-[420px] lg:w-[500px] xl:w-[560px] h-56 sm:h-60 md:h-64 shadow-2xl' 
                    : 'w-24 sm:w-28 md:w-32 lg:w-40 h-40 sm:h-44 md:h-48 shadow-lg'
                  }
                  ${isSelected 
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/40' 
                    : isCenter 
                      ? 'border-border/60' 
                      : 'border-primary/20 bg-card/90'
                  }
                  ${isCenter 
                    ? 'hover:border-primary/60 hover:shadow-[0_0_60px_hsl(var(--primary)/0.25)]' 
                    : 'hover:border-primary/40'
                  }
                `}
                style={{
                  transform,
                  opacity,
                  zIndex,
                  transformStyle: 'preserve-3d',
                  backfaceVisibility: 'hidden',
                  boxShadow: !isCenter 
                    ? '0 0 30px 8px hsl(var(--primary) / 0.2), 0 0 60px 15px hsl(var(--primary) / 0.1)' 
                    : undefined,
                }}
              >
                {/* Selection Checkbox - Center only */}
                {isCenter && (
                  <div
                    className={`absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 z-10 ${
                      isSelected
                        ? "bg-primary text-primary-foreground scale-110 shadow-lg"
                        : "bg-muted/90 hover:bg-muted"
                    }`}
                  >
                    {isSelected && <Check className="w-5 h-5 animate-scale-in" />}
                  </div>
                )}

                {/* Card Content */}
                <div className={`flex flex-col h-full ${isCenter ? "p-6" : "p-3"}`}>
                  {/* Header */}
                  <div className={`flex items-start gap-3 ${isCenter ? "mb-3" : "mb-1"}`}>
                    <Globe
                      className={`flex-shrink-0 transition-colors ${
                        isSelected ? "text-primary" : "text-muted-foreground"
                      } ${isCenter ? "w-6 h-6" : "w-4 h-4"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`font-semibold truncate ${isCenter ? "text-lg" : "text-xs"}`}>
                          {item.name}
                        </p>
                        {isDebugMode && hasParams && isCenter && (
                          <Settings className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Center Card Full Content */}
                  {isCenter && (
                    <>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                        <User className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{item.provider}</span>
                      </div>
                      <p
                        ref={setDescriptionRef(`carousel-${item.id}`)}
                        className="text-sm text-muted-foreground line-clamp-4 flex-1 leading-relaxed"
                      >
                        {item.description}
                      </p>
                      {truncatedItems.has(`carousel-${item.id}`) && (
                        <button
                          onClick={(e) => openDescriptionDialog(e, item.name, item.description)}
                          className="text-sm text-primary hover:underline mt-3 text-left relative z-10 font-medium"
                        >
                          Read more
                        </button>
                      )}
                    </>
                  )}

                  {/* Side Card Minimal Content */}
                  {!isCenter && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2 mt-1 opacity-80">
                      {item.provider}
                    </p>
                  )}
                </div>

                {/* Selection Glow */}
                {isCenter && isSelected && (
                  <div className="absolute inset-0 rounded-xl pointer-events-none bg-gradient-to-t from-primary/15 via-transparent to-transparent" />
                )}

                {/* Page Edge Shadow for 3D Effect */}
                <div 
                  className="absolute inset-y-0 right-0 w-4 pointer-events-none rounded-r-xl"
                  style={{
                    background: 'linear-gradient(to left, hsl(var(--background) / 0.3), transparent)',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Indicator */}
      {items.length > 1 && (
        <div className="flex justify-center items-center gap-4 mt-8">
          <span className="text-sm font-medium text-muted-foreground tabular-nums">
            {activeIndex + 1} <span className="opacity-50">/</span> {items.length}
          </span>
          <div className="flex gap-2">
            {items.map((item, index) => (
              <button
                key={item.id}
                onClick={() => navigate(index)}
                disabled={isAnimating}
                className={`rounded-full transition-all duration-500 ${
                  index === activeIndex
                    ? "bg-primary w-8 h-2.5 shadow-[0_0_12px_hsl(var(--primary)/0.6)]"
                    : "bg-muted hover:bg-muted-foreground/40 w-2.5 h-2.5"
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Description Modal */}
      {descriptionDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setDescriptionDialog({ open: false, title: "", description: "" })}
          />
          <div className="relative z-10 w-full max-w-lg mx-4 bg-background border border-border rounded-xl p-6 shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{descriptionDialog.title}</h3>
              <button
                onClick={() => setDescriptionDialog({ open: false, title: "", description: "" })}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-[60vh] overflow-y-auto leading-relaxed">
              {descriptionDialog.description}
            </div>
          </div>
        </div>
      )}

      {/* Parameters Modal */}
      {paramsDialog.open && paramsDialog.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={closeParamsDialog} />
          <div className="relative z-10 w-full max-w-md mx-4 bg-background border border-border rounded-xl p-6 shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">{paramsDialog.item.name}</h3>
                <p className="text-sm text-muted-foreground">Configure API Parameters</p>
              </div>
              <button
                onClick={closeParamsDialog}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 max-h-[50vh] overflow-y-auto">
              {paramsDialog.item.queryParams.map((param) => (
                <div key={param} className="space-y-2">
                  <Label htmlFor={`param-${param}`} className="text-sm font-medium">
                    {param}
                  </Label>
                  <Input
                    id={`param-${param}`}
                    value={params[paramsDialog.item!.id]?.[param] || ""}
                    onChange={(e) => updateParam(param, e.target.value)}
                    placeholder={`Enter ${param}`}
                    className="bg-background/50 border-border/50 focus:border-primary"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={closeParamsDialog}>
                Skip
              </Button>
              <Button onClick={closeParamsDialog}>Confirm</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CenterFocusCarousel;
