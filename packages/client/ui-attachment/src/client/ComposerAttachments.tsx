import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@phoenix-ai/dsh-client-ui-conversation/client'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'
import { capturePresenceFrame } from './presence-capture.ts'

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

/** Draft-image rail, document drop target, and original-image preview slot entry. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddImages, onRemoveImage, dropLimits, t,
}: ComposerAttachmentsProps) {
  const [preview, setPreview] = useState<ComposerAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const capture = useRef<AbortController|null>(null)
  const [capturing,setCapturing]=useState(false)
  const [captureError,setCaptureError]=useState(false)
  const owner=useRef(onAddImages)
  owner.current=onAddImages
  useEffect(()=>()=>{capture.current?.abort();capture.current=null},[])
  useEffect(()=>{if(!canAcceptDrop)capture.current?.abort()},[canAcceptDrop])
  const startCapture=async(source:'screen'|'camera')=>{
    if(!canAcceptDrop||capture.current)return
    const controller=new AbortController()
    const target=onAddImages
    capture.current=controller;setCapturing(true);setCaptureError(false)
    try{
      const file=await capturePresenceFrame(controller.signal,source)
      if(!controller.signal.aborted&&capture.current===controller&&owner.current===target)target([file])
    }catch{if(!controller.signal.aborted&&capture.current===controller)setCaptureError(true)}
    finally{if(capture.current===controller){capture.current=null;setCapturing(false)}}
  }
  const closePreview = useCallback(() => { setPreview(null) }, [])

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (canAcceptDrop) onAddImages([...dataTransfer.files])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddImages])

  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map(attachment => ({
    id: attachment.id,
    kind: attachment.kind,
    alt: attachment.file.name || t(attachment.kind === 'file' ? 'file.pending' : 'image.pending'),
    removeLabel: t(attachment.kind === 'file' ? 'file.remove' : 'image.remove', { name: attachment.file.name }),
    attachment,
    ...attachment.previewUrl === undefined ? {} : { previewUrl: attachment.previewUrl },
  })), [attachments, t])

  return (
    <>
      {typeof navigator!=='undefined'&&(typeof navigator.mediaDevices?.getDisplayMedia==='function'||typeof navigator.mediaDevices?.getUserMedia==='function')&&<div className={css.capture}>
        {typeof navigator.mediaDevices?.getDisplayMedia==='function'&&<button type="button" disabled={!canAcceptDrop||capturing} onClick={()=>{void startCapture('screen')}}>{t('image.captureScreen')}</button>}
        {typeof navigator.mediaDevices?.getUserMedia==='function'&&<button type="button" disabled={!canAcceptDrop||capturing} onClick={()=>{void startCapture('camera')}}>{t('image.captureCamera')}</button>}
        {capturing&&<button type="button" onClick={()=>capture.current?.abort()}>{t('image.cancelCapture')}</button>}
        {captureError&&<span role="status">{t('image.captureFailed')}</span>}
      </div>}
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits, attachments.some(attachment => attachment.kind === 'file'))}
        />
      )}
      {railItems.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={railItems}
            labels={attachmentRailLabels(t)}
            onOpen={(item) => {
              if (item.attachment.kind === 'image' && item.attachment.previewUrl !== undefined) {
                setPreview(item.attachment)
              }
            }}
            onRemove={(item) => { onRemoveImage(item.attachment.id) }}
          />
        </div>
      )}
      {preview?.kind === 'image' && preview.previewUrl !== undefined && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
