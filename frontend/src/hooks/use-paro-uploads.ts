"use client";

import { ChangeEvent, DragEvent, useCallback, useRef, useState } from "react";
import { deleteParoUpload, uploadParoFile } from "@/lib/paro-api";
import type { UploadedFileItem } from "@/types/paro";

function createSessionId() {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

type UseParoUploadsOptions = {
  apiBase: string;
  sessionId: string | null;
  pending: boolean;
  uploadErrorMessage: string;
  refreshSessions: () => void;
  setError: (value: string | null) => void;
  setSessionId: (value: string | null) => void;
  setUploadedFiles: (value: UploadedFileItem[] | ((previous: UploadedFileItem[]) => UploadedFileItem[])) => void;
};

export function useParoUploads({
  apiBase,
  sessionId,
  pending,
  uploadErrorMessage,
  refreshSessions,
  setError,
  setSessionId,
  setUploadedFiles,
}: UseParoUploadsOptions) {
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || uploadingFiles || pending) return;
    const targetSessionId = sessionId || createSessionId();
    if (!sessionId) setSessionId(targetSessionId);
    setUploadingFiles(true);
    setError(null);

    try {
      const uploaded: UploadedFileItem[] = [];
      for (const file of files) {
        const upload = await uploadParoFile(apiBase, targetSessionId, file);
        if (upload) uploaded.push(upload);
      }

      if (uploaded.length > 0) {
        setUploadedFiles((prev) => {
          const next = new Map(prev.map((item) => [item.id, item]));
          uploaded.forEach((item) => next.set(item.id, item));
          return Array.from(next.values()).sort((a, b) => a.uploaded_at - b.uploaded_at);
        });
      }
      void refreshSessions();
    } catch (err) {
      const message = err instanceof Error ? err.message : uploadErrorMessage;
      setError(message);
    } finally {
      setUploadingFiles(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [
    apiBase,
    pending,
    refreshSessions,
    sessionId,
    setError,
    setSessionId,
    setUploadedFiles,
    uploadErrorMessage,
    uploadingFiles,
  ]);

  const onFilesSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    void uploadFiles(files);
  }, [uploadFiles]);

  const removeUploadedFile = useCallback(async (uploadId: string) => {
    if (!sessionId || pending || uploadingFiles || deletingUploadId) return;
    setDeletingUploadId(uploadId);
    setError(null);

    try {
      setUploadedFiles(await deleteParoUpload(apiBase, sessionId, uploadId));
      void refreshSessions();
    } catch (err) {
      const message = err instanceof Error ? err.message : uploadErrorMessage;
      setError(message);
    } finally {
      setDeletingUploadId(null);
    }
  }, [
    apiBase,
    deletingUploadId,
    pending,
    refreshSessions,
    sessionId,
    setError,
    setUploadedFiles,
    uploadErrorMessage,
    uploadingFiles,
  ]);

  const handleComposerDragEnter = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    if (!pending && !uploadingFiles) {
      setDragActive(true);
    }
  }, [pending, uploadingFiles]);

  const handleComposerDragOver = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = pending || uploadingFiles ? "none" : "copy";
    if (!pending && !uploadingFiles && !dragActive) {
      setDragActive(true);
    }
  }, [dragActive, pending, uploadingFiles]);

  const handleComposerDragLeave = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }, []);

  const handleComposerDrop = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (pending || uploadingFiles) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length === 0) return;
    void uploadFiles(files);
  }, [pending, uploadFiles, uploadingFiles]);

  return {
    deletingUploadId,
    dragActive,
    fileInputRef,
    handleComposerDragEnter,
    handleComposerDragLeave,
    handleComposerDragOver,
    handleComposerDrop,
    onFilesSelected,
    removeUploadedFile,
    uploadingFiles,
  };
}
