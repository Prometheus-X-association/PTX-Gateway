import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export interface ChatAvailabilityTarget {
  id: string;
  label: string;
  type: "software" | "serviceChain";
}

interface ChatAvailabilitySelectorProps {
  targetIds: string[];
  targets: ChatAvailabilityTarget[];
  onChange: (targetIds: string[]) => void;
}

export const ChatAvailabilitySelector = ({ targetIds, targets, onChange }: ChatAvailabilitySelectorProps) => {
  const toggleTarget = (targetId: string, checked: boolean) => {
    onChange(checked
      ? Array.from(new Set([...targetIds, targetId]))
      : targetIds.filter((id) => id !== targetId));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs">Show In Chat For</Label>
        <span className="text-[10px] text-muted-foreground">
          {targetIds.length === 0 ? "All services and service chains" : `${targetIds.length} selected`}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Select one or more result targets. Leave all unchecked to show this item on every result page.
      </p>
      {targets.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No services or service chains found yet.
        </p>
      ) : (
        <div className="grid max-h-56 grid-cols-1 gap-2 overflow-auto rounded-md border bg-background/30 p-3 md:grid-cols-2">
          {targets.map((target) => (
            <label key={target.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={targetIds.includes(target.id)}
                onCheckedChange={(checked) => toggleTarget(target.id, checked === true)}
              />
              <span>
                <span className="font-medium">{target.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {target.type === "software" ? "Service" : "Service Chain"}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
