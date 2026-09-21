import { useState, useRef, useId, type DragEvent, type ChangeEvent } from 'react';
import { FileText } from 'lucide-react';
import { formatFileSize, parseMediaMetadata, registerMediaMetadata, type FileMetadata } from './mediaUtils';
import { safeMediaUrl } from '../../guideTemplate';

export interface MediaUploadFieldProps {
  type: 'video' | 'pdf' | 'image';
  accept: string;
  acceptedFormatsText: string;
  dropText: string;
  buttonText: string;
  value?: string;
  initialValue?: string;
  fileMeta?: FileMetadata | null;
  onChange: (url: string, file: File | null) => void;
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
  fileMeta,
  onChange,
  showPreviewImage = false,
}: MediaUploadFieldProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // Validate file against accepted extensions and mime types
  const validateFile = (file: File): boolean => {
    const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    const mime = file.type.toLowerCase();

    if (type === 'video') {
      const validExts = ['.mp4', '.webm', '.mov'];
      const validMimes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'];
      if (!validExts.includes(ext) && !validMimes.includes(mime)) {
        setError('Accepted formats: MP4, WebM, MOV');
        return false;
      }
    } else if (type === 'pdf') {
      if (ext !== '.pdf' && mime !== 'application/pdf') {
        setError('Accepted format: PDF');
        return false;
      }
    } else if (type === 'image') {
      const validExts = ['.png', '.jpg', '.jpeg', '.webp'];
      const validMimes = ['image/png', 'image/jpeg', 'image/webp'];
      if (!validExts.includes(ext) && !validMimes.includes(mime)) {
        setError('Accepted formats: PNG, JPG, WebP');
        return false;
      }
    }

    setError('');
    return true;
  };

  const handleSelectFile = (file: File) => {
    if (!validateFile(file)) return;
    const objectUrl = `${URL.createObjectURL(file)}#name=${encodeURIComponent(file.name)}&size=${file.size}`;
    registerMediaMetadata(objectUrl, { name: file.name, size: file.size });
    onChange(objectUrl, file);
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
    onChange('', null);
  };

  const handleUndoRemove = () => {
    if (initialValue) {
      setError('');
      onChange(initialValue, null);
    }
  };

  const hasSelectedMedia = Boolean(value && value.trim());
  const isRemoved = Boolean(!hasSelectedMedia && initialValue && initialValue.trim());
  const isReplaced = Boolean(hasSelectedMedia && initialValue && value !== initialValue);

  // Metadata determination
  const parsedMeta = parseMediaMetadata(value, type);
  const displayName = fileMeta?.name || parsedMeta.name;
  const displaySize = fileMeta?.size ? formatFileSize(fileMeta.size) : parsedMeta.formattedSize;

  const replaceButtonText = type === 'video' ? 'Replace Video' : type === 'pdf' ? 'Replace PDF' : 'Replace';
  const removeButtonText = type === 'video' ? 'Remove Video' : type === 'pdf' ? 'Remove PDF' : 'Remove';
  const safeSrc = safeMediaUrl(value);

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
      />

      {hasSelectedMedia ? (
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
