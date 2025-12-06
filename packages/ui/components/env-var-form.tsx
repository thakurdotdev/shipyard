import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { Trash2, Plus, Eye, EyeOff, Save, Loader2 } from "lucide-react";

export function EnvVarForm({
  projectId,
  initialVars,
  onUpdate,
}: {
  projectId: string;
  initialVars: any[];
  onUpdate: () => void;
}) {
  const [vars, setVars] = useState<any[]>(initialVars);
  const [loading, setLoading] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // Only update vars if initialVars changes AND we haven't touched anything?
    // Or just always sync? For simple UX, let's sync but preserve edits if possible.
    // Actually, simple approach: Reset on initialVars change
    setVars(initialVars);
    setHasChanges(false);
  }, [initialVars]);

  const addEnvVar = () => {
    setVars([...vars, { key: "", value: "" }]);
    setHasChanges(true);
  };

  const removeEnvVar = (index: number) => {
    const newVars = [...vars];
    newVars.splice(index, 1);
    setVars(newVars);
    setHasChanges(true);
  };

  const updateEnvVar = (
    index: number,
    field: "key" | "value",
    value: string,
  ) => {
    const newVars = [...vars];
    newVars[index][field] = value;
    setVars(newVars);
    setHasChanges(true);
  };

  const handlePaste = (e: React.ClipboardEvent, index: number) => {
    const text = e.clipboardData.getData("text");
    if (text.includes("\n") || text.includes("=")) {
      e.preventDefault();
      const pastedVars: { key: string; value: string }[] = [];
      text.split("\n").forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          pastedVars.push({ key: match[1].trim(), value: match[2].trim() });
        }
      });

      if (pastedVars.length > 0) {
        const currentVars = [...vars];
        const isCurrentRowEmpty =
          !currentVars[index].key && !currentVars[index].value;
        if (isCurrentRowEmpty) {
          currentVars.splice(index, 1, ...pastedVars);
        } else {
          currentVars.splice(index + 1, 0, ...pastedVars);
        }
        setVars(currentVars);
        setHasChanges(true);
      }
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      // Identify deletions
      const currentKeys = new Set(vars.map((v) => v.key));
      const initialKeys = new Set(initialVars.map((v) => v.key));

      const toDelete = initialVars.filter((v) => !currentKeys.has(v.key));
      const toUpsert = vars.filter((v) => v.key); // Ignore empty keys

      await Promise.all([
        ...toDelete.map((v) => api.deleteEnvVar(projectId, v.key)),
        ...toUpsert.map((v) =>
          api.addEnvVar(projectId, { key: v.key, value: v.value }),
        ),
      ]);

      onUpdate(); // Reload from server
      setHasChanges(false);
      alert("Saved changes!");
    } catch (e) {
      console.error(e);
      alert("Failed to save changes");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => setShowValues(!showValues)}
          >
            {showValues ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </Button>
          <span className="text-sm text-muted-foreground">
            {showValues ? "Hide Values" : "Show Values"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addEnvVar}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
          {hasChanges && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={loading}
              className="flex items-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Changes
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {vars.map((env, index) => (
          <div key={index} className="flex gap-2 items-start">
            <Input
              placeholder="KEY"
              value={env.key}
              onChange={(e) => updateEnvVar(index, "key", e.target.value)}
              onPaste={(e) => handlePaste(e, index)}
              className="font-mono text-xs"
            />
            <Input
              placeholder="VALUE"
              value={env.value}
              onChange={(e) => updateEnvVar(index, "value", e.target.value)}
              onPaste={(e) => handlePaste(e, index)}
              className="font-mono text-xs"
              type={showValues ? "text" : "password"}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              onClick={() => removeEnvVar(index)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        {vars.length === 0 && (
          <div
            className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-lg cursor-text hover:bg-muted/50 transition-colors"
            onClick={addEnvVar}
          >
            Click to add or paste .env content here
          </div>
        )}
      </div>
    </div>
  );
}
