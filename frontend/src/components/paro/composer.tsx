"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  RefObject,
} from "react";
import { ArrowUp, LoaderCircle, Paperclip, Square } from "lucide-react";
import { SkillPicker } from "@/components/paro/skill-picker";
import { cn } from "@/lib/utils";
import type { SkillGroupKey, SkillGroups, UploadedFileItem } from "@/types/paro";

type ComposerLabels = {
  placeholder: string;
  skillsBuiltin: string;
  skillsExternal: string;
  skillsGroupEmpty: string;
  skillsMaas: string;
  stop: string;
  uploadsAdd: string;
  uploadsRemove: string;
  uploadsUploading: string;
};

type ComposerProps = {
  deletingUploadId: string | null;
  dragActive: boolean;
  error: string | null;
  expandedSkillGroup: SkillGroupKey | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  input: string;
  isMobileApp: boolean;
  pending: boolean;
  selectedSkills: string[];
  sessionBusy: boolean;
  sessionId: string | null;
  skillGroups: SkillGroups;
  stopRequested: boolean;
  uploadedFiles: UploadedFileItem[];
  uploadingFiles: boolean;
  labels: ComposerLabels;
  onComposerDragEnter: (event: DragEvent<HTMLFormElement>) => void;
  onComposerDragLeave: (event: DragEvent<HTMLFormElement>) => void;
  onComposerDragOver: (event: DragEvent<HTMLFormElement>) => void;
  onComposerDrop: (event: DragEvent<HTMLFormElement>) => void;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemoveUploadedFile: (uploadId: string) => void;
  onSkillGroupToggle: (group: SkillGroupKey) => void;
  onStopCurrentTurn: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleSkill: (skillName: string) => void;
};

export function Composer({
  deletingUploadId,
  dragActive,
  error,
  expandedSkillGroup,
  fileInputRef,
  input,
  isMobileApp,
  pending,
  selectedSkills,
  sessionBusy,
  sessionId,
  skillGroups,
  stopRequested,
  uploadedFiles,
  uploadingFiles,
  labels,
  onComposerDragEnter,
  onComposerDragLeave,
  onComposerDragOver,
  onComposerDrop,
  onFilesSelected,
  onInputChange,
  onInputKeyDown,
  onRemoveUploadedFile,
  onSkillGroupToggle,
  onStopCurrentTurn,
  onSubmit,
  onToggleSkill,
}: ComposerProps) {
  const showStopButton = pending || sessionBusy;

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-20",
        isMobileApp ? "px-3 pb-3" : "px-4 pb-5 sm:px-6 lg:px-8"
      )}
    >
      <div className={cn("mx-auto", isMobileApp ? "max-w-[430px]" : "max-w-5xl")}>
        <form
          onSubmit={onSubmit}
          onDragEnter={onComposerDragEnter}
          onDragOver={onComposerDragOver}
          onDragLeave={onComposerDragLeave}
          onDrop={onComposerDrop}
          className={cn(
            "border border-black/8 bg-white/92 backdrop-blur transition-colors dark:border-white/8 dark:bg-[#111216]/96",
            dragActive && "border-dashed border-zinc-950 bg-zinc-50 dark:border-zinc-100 dark:bg-[#17181d]",
            isMobileApp
              ? "rounded-3xl p-3.5 shadow-[0_18px_50px_-38px_rgba(0,0,0,0.4)]"
              : "rounded-[30px] p-4 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.3)]"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onFilesSelected}
            className="hidden"
          />
          <SkillPicker
            expandedSkillGroup={expandedSkillGroup}
            mode="panel"
            selectedSkills={selectedSkills}
            skillGroups={skillGroups}
            onSkillGroupToggle={onSkillGroupToggle}
            onToggleSkill={onToggleSkill}
            labels={{
              skillsBuiltin: labels.skillsBuiltin,
              skillsExternal: labels.skillsExternal,
              skillsGroupEmpty: labels.skillsGroupEmpty,
              skillsMaas: labels.skillsMaas,
            }}
          />
          {uploadedFiles.length > 0 && (
            <div className="px-2 pb-2">
              <div className="flex flex-wrap gap-2">
                {uploadedFiles.map((file) => (
                  <div
                    key={file.id}
                    title={file.original_name}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-[11px] text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
                  >
                    <span className="truncate">{file.original_name}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveUploadedFile(file.id)}
                      disabled={pending || uploadingFiles || deletingUploadId !== null}
                      title={labels.uploadsRemove}
                      aria-label={labels.uploadsRemove}
                      className="shrink-0 text-zinc-400 transition-colors hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-500 dark:hover:text-zinc-200"
                    >
                      {deletingUploadId === file.id ? <LoaderCircle size={10} className="animate-spin" /> : <span aria-hidden="true">×</span>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dragActive && (
            <div className="px-2">
              <div className="rounded-2xl border border-dashed border-zinc-950 bg-zinc-950/[0.03] px-3 py-2.5 transition-colors dark:border-zinc-100 dark:bg-white/[0.06]">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {labels.uploadsAdd}
                </div>
              </div>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 border-t border-black/6 px-2 pt-3 dark:border-white/6">
            <textarea
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={labels.placeholder}
              rows={isMobileApp ? 2 : 3}
              className="min-h-[52px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-6 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
            {showStopButton ? (
              <button
                type="button"
                onClick={onStopCurrentTurn}
                disabled={stopRequested || !sessionId}
                title={labels.stop}
                aria-label={labels.stop}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-400/45 bg-transparent text-rose-600 transition-colors hover:bg-rose-500/8 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-300/40 dark:text-rose-300 dark:hover:bg-rose-400/12"
              >
                {stopRequested ? (
                  <LoaderCircle className="animate-spin" size={12} />
                ) : (
                  <Square size={11} />
                )}
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || uploadingFiles || sessionBusy}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/15 bg-transparent text-zinc-700 transition-colors hover:bg-zinc-900/6 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/20 dark:text-zinc-200 dark:hover:bg-white/10"
              >
                <ArrowUp size={13} />
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending || uploadingFiles}
              title={uploadingFiles ? labels.uploadsUploading : labels.uploadsAdd}
              aria-label={uploadingFiles ? labels.uploadsUploading : labels.uploadsAdd}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-zinc-600 transition-colors hover:bg-zinc-900/6 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/14 dark:text-zinc-300 dark:hover:bg-white/10"
            >
              {uploadingFiles ? <LoaderCircle size={12} className="animate-spin" /> : <Paperclip size={12} />}
            </button>
            <SkillPicker
              expandedSkillGroup={expandedSkillGroup}
              mode="buttons"
              selectedSkills={selectedSkills}
              skillGroups={skillGroups}
              onSkillGroupToggle={onSkillGroupToggle}
              onToggleSkill={onToggleSkill}
              labels={{
                skillsBuiltin: labels.skillsBuiltin,
                skillsExternal: labels.skillsExternal,
                skillsGroupEmpty: labels.skillsGroupEmpty,
                skillsMaas: labels.skillsMaas,
              }}
            />
          </div>
        </form>
        {error && <p className="mt-3 text-center text-sm text-rose-500">{error}</p>}
      </div>
    </div>
  );
}
