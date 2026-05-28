import { ReactNode } from "react";
import { Sparkles } from "lucide-react";

interface GatewayHeaderProps {
  rightSlot?: ReactNode;
  badgeText?: string;
}

const GatewayHeader = ({ rightSlot, badgeText = "Data Analytics Platform" }: GatewayHeaderProps) => {
  return (
    <header className="text-center mb-4 relative h-[clamp(96px,15vh,140px)] overflow-hidden flex flex-col justify-center">
      {rightSlot ? <div className="absolute top-0 right-0">{rightSlot}</div> : null}

      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-2 mx-auto">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-[clamp(11px,1.2vh,13px)] text-primary font-medium">{badgeText}</span>
      </div>
      <h1 className="text-[clamp(1.35rem,2.9vh,2.2rem)] font-bold mb-1 leading-tight">
        Transform Your Data Into{" "}
        <span className="gradient-text">Insights</span>
      </h1>
      <p className="text-[clamp(11px,1.35vh,15px)] text-muted-foreground max-w-2xl mx-auto leading-snug">
        Upload your data, select your analysis type, and let our platform
        generate actionable insights in minutes
      </p>
    </header>
  );
};

export default GatewayHeader;
