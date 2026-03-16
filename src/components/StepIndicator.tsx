import { Check } from "lucide-react";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

const StepIndicator = ({ steps, currentStep }: StepIndicatorProps) => {
  return (
    <div className="flex items-center justify-center gap-2 mb-12">
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
              className={`mt-2 text-xs font-medium ${
                index <= currentStep
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {step}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`w-16 h-0.5 mx-2 mb-6 transition-colors duration-300 ${
                index < currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default StepIndicator;
