import { Check } from "lucide-react";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
  orientation?: "horizontal" | "vertical";
}

const StepIndicator = ({ steps, currentStep, orientation = "horizontal" }: StepIndicatorProps) => {
  const isVertical = orientation === "vertical";

  if (isVertical) {
    return (
      <div className="w-full">
        <div className="flex flex-col items-start w-full">
          {steps.map((step, index) => (
            <div key={step} className="w-full">
              <div className="flex items-center gap-3 w-full">
                <div className="shrink-0">
                  <div
                    className={`step-indicator ${
                      index < currentStep
                        ? "completed"
                        : index === currentStep
                          ? "active"
                          : "pending"
                    }`}
                  >
                    {index < currentStep ? <Check className="w-5 h-5" /> : index + 1}
                  </div>
                </div>
                <span
                  className={`text-[clamp(10px,1.05vh,12px)] font-medium leading-tight text-left whitespace-normal break-words ${
                    index <= currentStep ? "text-foreground" : "text-muted-foreground"
                  }`}
                  title={step}
                >
                  {step}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className="ml-[19px] my-1">
                  <div
                    className={`transition-colors duration-300 ${
                      index < currentStep ? "bg-primary" : "bg-muted"
                    }`}
                    style={{ width: "2px", height: "20px" }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[7vh] min-h-[52px] max-h-[72px] mb-4 pt-1 flex items-center justify-center overflow-visible">
      <div className="flex items-start justify-center gap-[var(--step-indicator-gap)] w-full">
      {steps.map((step, index) => (
        <div key={step} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`step-indicator ${
                index < currentStep
                  ? "completed"
                  : index === currentStep
                  ? "active"
                  : "pending"
              }`}
            >
              {index < currentStep ? (
                <Check className="w-5 h-5" />
              ) : (
                index + 1
              )}
            </div>
            <span
              className={`mt-1 text-[clamp(10px,1.05vh,12px)] font-medium leading-tight text-center max-w-[90px] truncate ${
                index <= currentStep
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
              title={step}
            >
              {step}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`mx-2 mb-6 transition-colors duration-300 ${
                index < currentStep ? "bg-primary" : "bg-muted"
              }`}
              style={{
                width: "var(--step-indicator-connector-width)",
                height: "var(--step-indicator-connector-height)",
              }}
            />
          )}
        </div>
      ))}
      </div>
    </div>
  );
};

export default StepIndicator;
