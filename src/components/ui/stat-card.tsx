import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  iconColor?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeType = "neutral",
  icon: Icon,
  iconColor = "bg-helplus-primary-50 text-helplus-link",
}: StatCardProps) {
  return (
    <div className="bg-helplus-surface rounded-xl border border-helplus-border p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-helplus-text-light">{title}</p>
          <p className="text-2xl font-bold text-helplus-text mt-1">{value}</p>
          {change && (
            <p
              className={cn(
                "text-xs mt-1 font-medium",
                changeType === "positive" && "text-helplus-success",
                changeType === "negative" && "text-helplus-danger",
                changeType === "neutral" && "text-helplus-text-light"
              )}
            >
              {change}
            </p>
          )}
        </div>
        <div className={cn("p-2.5 rounded-lg", iconColor)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
