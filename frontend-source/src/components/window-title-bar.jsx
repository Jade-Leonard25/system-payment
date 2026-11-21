import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button } from "./ui/button";

const dragRegion = { WebkitAppRegion: "drag" };
const noDragRegion = { WebkitAppRegion: "no-drag" };

export default function WindowTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [controlError, setControlError] = useState("");
  const controls = window.windowControls;

  const handleClose = async () => {
    setControlError("");
    if (!controls?.close) {
      setControlError("Window controls are unavailable. Restart the app.");
      return;
    }

    try {
      await controls.close();
    } catch (error) {
      setControlError(
        error instanceof Error ? error.message : "Could not close the app.",
      );
    }
  };

  useEffect(() => {
    if (!controls?.onMaximizeChange) return undefined;
    return controls.onMaximizeChange(setIsMaximized);
  }, [controls]);

  return (
    <header
      className="relative z-50 flex h-9 shrink-0 select-none items-center justify-between border-b bg-background px-3"
      style={noDragRegion}
    >
      <span className="truncate text-xs font-medium text-muted-foreground">
        Payroll
      </span>
      <div className="h-full min-w-4 flex-1" style={dragRegion} aria-hidden="true" />
      <div className="flex min-w-0 items-center" style={noDragRegion}>
        {controlError && (
          <span role="alert" className="mr-2 truncate text-xs text-destructive">
            {controlError}
          </span>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          style={noDragRegion}
          className="size-8 rounded-none text-muted-foreground"
          aria-label="Minimize window"
          title="Minimize"
          onClick={() => controls?.minimize()}
        >
          <Minus />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          style={noDragRegion}
          className="size-8 rounded-none text-muted-foreground"
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
          title={isMaximized ? "Restore" : "Maximize"}
          onClick={() => controls?.maximize()}
        >
          {isMaximized ? <Copy className="size-3" /> : <Square />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          style={noDragRegion}
          className="size-8 rounded-none text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
          aria-label="Close window"
          title="Close"
          onClick={handleClose}
        >
          <X />
        </Button>
      </div>
    </header>
  );
}
