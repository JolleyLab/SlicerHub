// Backend-agnostic file/attachment service.
export {
    uploadFileResumable as uploadFile,
    attachUploadedFile,
    deleteDirectusCaseAttachment as deleteAttachment,
    openDirectusAttachmentFullSlicer as openAttachmentInViewer,
    fetchDirectusAttachmentContent as fetchAttachmentContent,
    checkDirectusAttachmentDownload as checkAttachmentDownload,
    directusAttachmentDownloadUrl as getAttachmentDownloadUrl,
    saveDirectusCaseAttachmentScene as saveAttachmentScene,
    saveDirectusSlicerWebScene as saveSlicerWebScene,
    fetchAttachmentActivity,
} from './directus.js';
