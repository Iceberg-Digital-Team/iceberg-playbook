import { useState, useRef, useId, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { formatFileSize, parseMediaMetadata, registerMediaMetadata, type FileMetadata } from './mediaUtils';
import { safeMediaUrl } from '../../guideTemplate';
import { uploadMedia, validateMediaFile, getSignedMediaUrl, isStorageKey } from '../../services/mediaService';

export interface MediaUploadFieldProps {
  type: 'video' | 'pdf' | 'image';
  accept: string;
  acceptedFormatsText: string;
  dropText: string;
  buttonText: string;
  value?: string;
  initialValue?: string;
  storageKey?: string;
  fileMeta?: FileMetadata | null;
  domain?: 'guides' | 'issues' | 'sops';
  entityId?: string;
  onChange: (url: string, file: File | null, storageKey?: string) => void;
  showPreviewImage?: boolean;
}

export function MediaUploadField({
  type,
  accept,
  acceptedFormatsText,
  dropText,
  buttonText,
  value,
  initialValue,
  storageKey,
  fileMeta,
  domain = 'guides',
  entityId,
  onChange,
  showPreviewImage = false,
}: MediaUploadFieldProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string>(value || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // If value is a storage key, resolve signed preview at runtime
  useEffect(() => {
    let active = true;
    if (value && isStorageKey(value)) {
      getSignedMediaUrl(value)
        .then(signed => {
          if (active) setPreviewUrl(signed);
        })
        .catch(() => {
          if (active) setPreviewUrl(value);
        });
    }
    return () => {
      active = false;
    };
  }, [value]);

  const handleSelectFile = async (file: File) => {
    const validation = validateMediaFile(file, type);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file.');
      return;
    }

    setError('');
    setIsUploading(true);

    try {
      const result = await uploadMedia(file, {
        domain,
        entityId,
        mediaType: type
      });

      registerMediaMetadata(result.signedUrl, { name: file.name, size: file.size });
      registerMediaMetadata(result.storageKey, { name: file.name, size: file.size });
      setPreviewUrl(result.signedUrl);
      onChange(result.signedUrl, file, result.storageKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleSelectFile(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleSelectFile(file);
    }
  };

  const handleReplace = () => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
    }
  };

  const handleRemove = () => {
    setError('');
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    setPreviewUrl('');
    onChange('', null, '');
  };

  const handleUndoRemove = () => {
    if (initialValue) {
      setError('');
      setPreviewUrl(initialValue);
      onChange(initialValue, null, storageKey);
    }
  };

  const hasSelectedMedia = Boolean((value && value.trim()) || (previewUrl && previewUrl.trim()));
  const isRemoved = Boolean(!hasSelectedMedia && initialValue && initialValue.trim());
  const isReplaced = Boolean(hasSelectedMedia && initialValue && value !== initialValue);

  // Metadata determination
  const parsedMeta = parseMediaMetadata(previewUrl || value, type);
  const displayName = fileMeta?.name || parsedMeta.name;
  const displaySize = fileMeta?.size ? formatFileSize(fileMeta.size) : parsedMeta.formattedSize;

  const replaceButtonText = type === 'video' ? 'Replace Video' : type === 'pdf' ? 'Replace PDF' : 'Replace';
  const removeButtonText = type === 'video' ? 'Remove Video' : type === 'pdf' ? 'Remove PDF' : 'Remove';
  const safeSrc = safeMediaUrl(previewUrl || value);

  return (
    <div className="media-upload-container">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-label={buttonText}
        disabled={isUploading}
      />

      {isUploading ? (
        <div className="media-upload-area is-uploading">
          <div className="media-upload-content">
            <Loader2 size={24} className="spin" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} />
            <span className="media-drop-text">Uploading {type} to secure storage…</span>
          </div>
          <p className="helper-text media-format-text">Please wait while your file is securely uploaded.</p>
        </div>
      ) : hasSelectedMedia ? (
        <div className={`media-selected-card ${type === 'video' ? 'media-video-card' : ''}`}>
          {type === 'video' && safeSrc && (
            <div className="media-preview-video-container">
              <video
                className="media-preview-video"
                controls
                preload="metadata"
                src={safeSrc}
              />
            </div>
          )}

          <div className="media-file-info-row">
            {type === 'pdf' && (
              <div className="media-file-icon">
                <FileText size={20} aria-hidden="true" />
              </div>
            )}

            {(type === 'image' || showPreviewImage) && safeSrc && (
              <div className="media-preview-thumb">
                <img src={safeSrc} alt={displayName || 'Screenshot preview'} />
              </div>
            )}

            <div className="media-file-info">
              <div className="media-file-name-container">
                <span className="media-file-name">{displayName}</span>
                {isReplaced && <span className="media-badge-status">Replacement pending</span>}
              </div>
              {displaySize && <span className="media-file-size helper-text">{displaySize}</span>}
            </div>

            <div className="media-file-actions">
              {type === 'pdf' && safeSrc && (
                <a
                  className="btn-secondary media-action-btn"
                  href={safeSrc}
                  target="_blank"
                  rel="noreferrer"
                  download={displayName}
                >
                  View PDF
                </a>
              )}
              <button
                type="button"
                className="btn-secondary media-action-btn"
                onClick={handleReplace}
              >
                {replaceButtonText}
              </button>
              <button
                type="button"
                className="btn-secondary media-action-btn"
                onClick={handleRemove}
              >
                {removeButtonText}
              </button>
            </div>
          </div>
          {error && <p className="knowledge-error media-inline-error" role="alert">{error}</p>}
        </div>
      ) : isRemoved ? (
        <div className="media-upload-area media-removed-area">
          <div className="media-removed-row">
            <span className="media-removed-text">
              {type === 'video' ? 'No video attached' : type === 'pdf' ? 'No PDF attached' : 'No screenshot attached'}
            </span>
            <div className="media-removed-actions">
              <button
                type="button"
                className="btn-secondary media-choose-btn"
                onClick={() => inputRef.current?.click()}
              >
                {buttonText}
              </button>
              {initialValue && (
                <button
                  type="button"
                  className="btn-secondary media-action-btn"
                  onClick={handleUndoRemove}
                >
                  Undo Remove
                </button>
              )}
            </div>
          </div>
          {error && <p className="knowledge-error media-inline-error" role="alert">{error}</p>}
        </div>
      ) : (
        <div
          className={`media-upload-area ${isDragging ? 'is-dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="media-upload-content">
            <span className="media-drop-text">{dropText}</span>
            <span className="media-or-divider">or</span>
            <button
              type="button"
              className="btn-secondary media-choose-btn"
              onClick={() => inputRef.current?.click()}
            >
              {buttonText}
            </button>
          </div>
          <p className="helper-text media-format-text">{acceptedFormatsText}</p>
          {error && <p className="knowledge-error media-inline-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
