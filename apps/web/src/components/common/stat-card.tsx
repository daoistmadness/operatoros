import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  trend?: React.ReactNode;
  iconBgColor?: string;
}

export function StatCard({ title, value, icon, trend, iconBgColor, className, ...props }: StatCardProps) {
  return (
    <Card className={cn("p-6 flex flex-col justify-between shadow-sm hover:y-[-4px] hover:scale-[1.01] transition-all duration-200", className)} {...props}>
      <div className="flex items-start justify-between">
        {icon && (
          <div className={cn("p-3 rounded-xl shadow-inner", iconBgColor)}>
            {icon}
          </div>
        )}
      </div>
      <div className="mt-6">
        <div className="text-[2.5rem] font-bold tracking-tight text-slate-900 leading-none">{value}</div>
        <p className="text-slate-500 font-semibold mt-2">{title}</p>
      </div>
      {trend && (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-400">{trend}</span>
        </div>
      )}
    </Card>
  );
}
