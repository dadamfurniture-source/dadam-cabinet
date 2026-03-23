// ═══════════════════════════════════════════════════════════════
// Images Route - 이미지 업로드/조회/삭제 API
// POST /api/images/upload
// GET  /api/images
// DELETE /api/images/:id
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import {
  uploadImage, createUserImage, listUserImages, deleteUserImage,
} from '../clients/supabase-user.client.js';
import type { UserImageType } from '../types/index.js';

const log = createLogger('route:images');
const router = Router();

const VALID_IMAGE_TYPES: UserImageType[] = ['site_photo', 'ai_generated'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB in base64 chars

// ─── POST /api/images/upload ───
router.post('/api/images/upload', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { image_data, mime_type, file_name, image_type, design_id, door_state, metadata } = req.body;

    if (!image_data) throw new ValidationError('image_data (base64) is required', 'image_data');
    if (!mime_type) throw new ValidationError('mime_type is required', 'mime_type');
    if (image_data.length > MAX_IMAGE_SIZE) {
      throw new ValidationError('Image exceeds 10MB limit', 'image_data');
    }
    if (image_type && !VALID_IMAGE_TYPES.includes(image_type)) {
      throw new ValidationError(`image_type must be one of: ${VALID_IMAGE_TYPES.join(', ')}`, 'image_type');
    }

    const safeName = (file_name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
    const extension = mime_type.split('/')[1] || 'jpg';
    const fileName = safeName.includes('.') ? safeName : `${safeName}.${extension}`;
    const imgType = image_type || 'site_photo';

    // 1) Storage에 업로드
    const { storagePath, publicUrl, fileSize } = await uploadImage(
      req.supabaseToken!,
      req.user!.id,
      imgType,
      fileName,
      image_data,
      mime_type,
    );

    // 2) DB 레코드 생성 (user_id 직접 포함 — RLS 통과)
    const userImage = await createUserImage(req.supabaseToken!, {
      user_id: req.user!.id,
      image_type: imgType,
      storage_path: storagePath,
      public_url: publicUrl,
      file_name: fileName,
      file_size_bytes: fileSize,
      mime_type: mime_type,
      design_id: design_id || null,
      door_state: door_state || null,
      metadata: metadata || null,
    });

    log.info({ imageId: userImage.id, userId: req.user!.id, storagePath }, 'Image uploaded');
    res.status(201).json({
      success: true,
      data: {
        id: userImage.id,
        storage_path: userImage.storage_path,
        public_url: userImage.public_url,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/images ───
router.get('/api/images', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const designId = req.query.design_id as string | undefined;
    const images = await listUserImages(req.supabaseToken!, designId);
    res.json({ success: true, data: images });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/images/:id ───
router.delete('/api/images/:id', requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    await deleteUserImage(req.supabaseToken!, req.params.id);
    log.info({ imageId: req.params.id, userId: req.user!.id }, 'Image deleted');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
