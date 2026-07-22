"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listSkills } from "@/lib/paro-api";
import type { SkillGroupKey, SkillGroups, SkillItem } from "@/types/paro";

const RECENT_SKILLS_STORAGE_KEY = "paro.recentSkills";

type UseParoSkillsOptions = {
  apiBase: string;
};

export function useParoSkills({ apiBase }: UseParoSkillsOptions) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [recentSkills, setRecentSkills] = useState<string[]>([]);
  const [expandedSkillGroup, setExpandedSkillGroup] = useState<SkillGroupKey | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(RECENT_SKILLS_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 8);
      setRecentSkills(normalized);
    } catch {
      // Ignore malformed localStorage payload.
    }
  }, []);

  const applyLoadedSkills = useCallback((loadedSkills: SkillItem[]) => {
    setSkills(loadedSkills);
    setSelectedSkills((prev) => prev.filter((name) => loadedSkills.some((skill) => skill.name === name)));
    setRecentSkills((prev) => prev.filter((name) => loadedSkills.some((skill) => skill.name === name)));
  }, []);

  const refreshSkills = useCallback(async (signal?: AbortSignal, baseOverride?: string) => {
    try {
      const base = baseOverride || apiBase;
      applyLoadedSkills(await listSkills(base, signal));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Ignore transient refresh failures.
    }
  }, [apiBase, applyLoadedSkills]);

  const rememberRecentSkill = useCallback((skillName: string) => {
    setRecentSkills((prev) => {
      const next = [skillName, ...prev.filter((name) => name !== skillName)].slice(0, 8);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECENT_SKILLS_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const toggleSkill = useCallback((skillName: string) => {
    const alreadySelected = selectedSkills.includes(skillName);
    setSelectedSkills((prev) =>
      alreadySelected ? prev.filter((name) => name !== skillName) : [...prev, skillName]
    );
    if (!alreadySelected) {
      rememberRecentSkill(skillName);
      setExpandedSkillGroup(null);
    }
  }, [rememberRecentSkill, selectedSkills]);

  const skillGroups = useMemo<SkillGroups>(() => {
    const categoryOf = (skill: SkillItem): SkillGroupKey => {
      if (skill.category) return skill.category;
      if (skill.name.startsWith("maas-")) return "maas";
      if (skill.source === "user" || skill.source === "project") return "external";
      return "builtin";
    };

    return {
      builtin: skills.filter((skill) => categoryOf(skill) === "builtin"),
      maas: skills.filter((skill) => categoryOf(skill) === "maas"),
      external: skills.filter((skill) => categoryOf(skill) === "external"),
    };
  }, [skills]);

  return {
    applyLoadedSkills,
    expandedSkillGroup,
    recentSkills,
    refreshSkills,
    selectedSkills,
    setExpandedSkillGroup,
    setRecentSkills,
    setSelectedSkills,
    setSkills,
    skillGroups,
    skills,
    toggleSkill,
  };
}
