import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import File from '../models/File.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors.js';

// Use memory storage - we'll save to disk ourselves after auth
const storage = multer.memoryStorage();

// File filter - validate file types
const fileFilter = (req, file, cb) => {
    // Allow common file types plus medical imaging formats
    const allowedMimes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/json',
        'application/zip',
        'application/x-zip-compressed',
        // Medical imaging formats
        'application/dicom',           // DICOM files (.dcm)
        'application/x-nrrd',          // NRRD files (.nrrd)
        'application/x-mrb',           // MRB files (.mrb - 3D Slicer Medical Reality Bundle)
        'application/octet-stream'     // Generic binary (fallback for .nrrd, .dcm, .mrb when browser can't identify)
    ];
    
    // Also check file extension for MRB files (3D Slicer Medical Reality Bundle)
    // Browsers may report .mrb files with various MIME types
    const fileName = file.originalname.toLowerCase();
    const isMRBFile = fileName.endsWith('.mrb');

    if (allowedMimes.includes(file.mimetype) || isMRBFile) {
        cb(null, true);
    } else {
        cb(new ValidationError(`File type ${file.mimetype} is not allowed`), false);
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max file size (for medical imaging files)
    }
});

export default function fileRoutes(app) {
    /**
     * Upload a file
     */
    app.post('/api/files/upload', authenticateToken, upload.single('file'), asyncHandler(async (req, res) => {
        if (!req.file) {
            throw new ValidationError('No file uploaded');
        }

        // Create user directory
        const userDir = path.join('userFiles', req.user.id.toString());
        fs.mkdirSync(userDir, { recursive: true });

        // Generate safe filename
        const sanitized = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueName = `${uuidv4()}-${sanitized}`;
        const filePath = path.join(userDir, uniqueName);

        // Write file to disk
        fs.writeFileSync(filePath, req.file.buffer);

        // Save file metadata to database
        const fileRecord = File.create({
            userId: req.user.id,
            originalName: req.file.originalname,
            storedName: uniqueName,
            filePath: filePath,
            fileSize: req.file.size,
            mimeType: req.file.mimetype
        });

        res.status(201).json({
            message: 'File uploaded successfully',
            file: {
                id: fileRecord.id,
                originalName: fileRecord.originalName,
                size: fileRecord.fileSize,
                mimeType: fileRecord.mimeType,
                uploadDate: fileRecord.uploadDate
            }
        });
    }));

    /**
     * Get list of user's files
     */
    app.get('/api/files', authenticateToken, asyncHandler(async (req, res) => {
        const files = File.findByUserId(req.user.id);

        // Format response
        const formattedFiles = files.map(file => ({
            id: file.id,
            originalName: file.original_name,
            size: file.file_size,
            mimeType: file.mime_type,
            uploadDate: file.upload_date,
            parentFileId: file.parent_file_id || null
        }));

        res.json({ files: formattedFiles });
    }));

    /**
     * Download a file
     */
    app.get('/api/files/:id', authenticateToken, asyncHandler(async (req, res) => {
        const fileId = parseInt(req.params.id);

        // Get file metadata
        const file = File.findById(fileId);

        if (!file) {
            throw new NotFoundError('File not found');
        }

        // Check if user owns the file
        if (!File.isOwner(fileId, req.user.id)) {
            throw new ForbiddenError('You do not have permission to access this file');
        }

        // Check if file exists on disk
        if (!fs.existsSync(file.file_path)) {
            throw new NotFoundError('File not found on disk');
        }

        // Send file
        res.download(file.file_path, file.original_name);
    }));

    /**
     * Delete a file
     */
    app.delete('/api/files/:id', authenticateToken, asyncHandler(async (req, res) => {
        const fileId = parseInt(req.params.id);

        // Get file metadata
        const file = File.findById(fileId);

        if (!file) {
            throw new NotFoundError('File not found');
        }

        // Check if user owns the file
        if (!File.isOwner(fileId, req.user.id)) {
            throw new ForbiddenError('You do not have permission to delete this file');
        }

        // Delete from disk
        if (fs.existsSync(file.file_path)) {
            fs.unlinkSync(file.file_path);
        }

        // Delete from database
        File.delete(fileId);

        res.json({ message: 'File deleted successfully' });
    }));

    /**
     * Get user storage statistics
     */
    app.get('/api/files/stats/storage', authenticateToken, asyncHandler(async (req, res) => {
        const bytesUsed = File.getUserStorageUsed(req.user.id);
        const files = File.findByUserId(req.user.id);

        res.json({
            bytesUsed,
            megabytesUsed: (bytesUsed / (1024 * 1024)).toFixed(2),
            fileCount: files.length
        });
    }));
}
