"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SkillGroupKey, SkillGroups } from "@/types/paro";

type SkillPickerLabels = {
  skillsBuiltin: string;
  skillsExternal: string;
  skillsGroupEmpty: string;
  skillsMaas: string;
};

type SkillPickerProps = {
  expandedSkillGroup: SkillGroupKey | null;
  mode?: "panel" | "buttons" | "full";
  selectedSkills: string[];
  skillGroups: SkillGroups;
  labels: SkillPickerLabels;
  onSkillGroupToggle: (group: SkillGroupKey) => void;
  onToggleSkill: (skillName: string) => void;
};

export function SkillPicker({
  expandedSkillGroup,
  mode = "full",
  selectedSkills,
  skillGroups,
  labels,
  onSkillGroupToggle,
  onToggleSkill,
}: SkillPickerProps) {
  const skillGroupItems = [
    { key: "builtin", label: labels.skillsBuiltin, items: skillGroups.builtin },
    { key: "maas", label: labels.skillsMaas, items: skillGroups.maas },
    { key: "external", label: labels.skillsExternal, items: skillGroups.external },
  ] as const;
  const expandedGroup = skillGroupItems.find((item) => item.key === expandedSkillGroup);
  const showPanel = mode === "panel" || mode === "full";
  const showButtons = mode === "buttons" || mode === "full";

  return (
    <>
      {showPanel && selectedSkills.length > 0 && (
        <div className="px-2 pb-2">
          <div className="flex flex-wrap gap-2">
            {selectedSkills.map((name) => (
              <button
                key={`selected:${name}`}
                type="button"
                onClick={() => onToggleSkill(name)}
                className="shrink-0 rounded-full border border-zinc-950 bg-zinc-950 px-3 py-1.5 text-[11px] text-zinc-50 transition-colors hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
      {showPanel && expandedGroup && (
        <div className="px-2 pb-2">
          <div className="rounded-2xl border border-black/8 bg-zinc-50/70 p-3 dark:border-white/10 dark:bg-white/5">
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {expandedGroup.label}
              </div>
              {expandedGroup.items.length > 0 ? (
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
                  {expandedGroup.items.map((skill) => {
                    const active = selectedSkills.includes(skill.name);
                    return (
                      <button
                        key={`${expandedGroup.key}:${skill.name}`}
                        type="button"
                        onClick={() => onToggleSkill(skill.name)}
                        title={skill.description || skill.name}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                          active
                            ? "border-zinc-950 bg-zinc-950 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                            : "border-black/8 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
                        )}
                      >
                        {skill.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {labels.skillsGroupEmpty}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showButtons && (
        <>
          {skillGroupItems.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => onSkillGroupToggle(group.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors",
                expandedSkillGroup === group.key
                  ? "border-zinc-950 bg-zinc-950 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                  : "border-black/10 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
              )}
            >
              <span>{group.label}</span>
              <span className={cn("text-[9px] opacity-70", expandedSkillGroup === group.key && "opacity-90")}>
                {group.items.length}
              </span>
              <ChevronRight
                size={12}
                className={cn("transition-transform", expandedSkillGroup === group.key && "rotate-90")}
              />
            </button>
          ))}
        </>
      )}
    </>
  );
}
