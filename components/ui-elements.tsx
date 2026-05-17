import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function Button({ 
  className, 
  variant = "primary", 
  size = "md", 
  isLoading = false,
  children, 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { 
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive",
  size?: "sm" | "md" | "lg" | "icon",
  isLoading?: boolean
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed",
        {
          "bg-primary text-primary-foreground shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0": variant === "primary",
          "bg-secondary text-secondary-foreground shadow-sm hover:shadow hover:bg-secondary/90": variant === "secondary",
          "bg-transparent border border-border text-foreground hover:bg-muted": variant === "outline",
          "bg-transparent text-foreground hover:bg-muted": variant === "ghost",
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90": variant === "destructive",
          
          "px-3 py-1.5 text-sm rounded-lg": size === "sm",
          "px-4 py-2 text-sm rounded-xl": size === "md",
          "px-6 py-3 text-base rounded-xl": size === "lg",
          "p-2 rounded-xl": size === "icon",
        },
        className
      )}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full px-4 py-2.5 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground",
        "focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200",
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string, children: React.ReactNode }) {
  return (
    <div className={cn(
      "bg-card rounded-2xl shadow-sm border border-border/50 overflow-hidden",
      className
    )}>
      {children}
    </div>
  );
}
