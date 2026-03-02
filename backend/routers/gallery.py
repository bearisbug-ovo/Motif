"""M8 — Gallery: Image CRUD + pagination + rating."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database import get_db
from models.image import Image
from schemas.image import ImageOut, RatingUpdate

router = APIRouter()


# ------------------------------------------------------------------ #
# GET /api/images                                                       #
# ------------------------------------------------------------------ #

@router.get("", response_model=list[ImageOut])
def list_images(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    character_id: int | None = None,
    model: str | None = None,
    min_rating: int | None = None,
    faceswapped: bool | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(Image).order_by(desc(Image.created_at))

    if character_id is not None:
        q = q.filter(Image.character_id == character_id)
    if model is not None:
        q = q.filter(Image.model == model)
    if min_rating is not None:
        q = q.filter(Image.rating >= min_rating)
    if faceswapped is not None:
        q = q.filter(Image.faceswapped == faceswapped)

    offset = (page - 1) * page_size
    return q.offset(offset).limit(page_size).all()


@router.get("/{image_id}", response_model=ImageOut)
def get_image(image_id: int, db: Session = Depends(get_db)):
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    return img


# ------------------------------------------------------------------ #
# PATCH /api/images/{id}/rating                                         #
# ------------------------------------------------------------------ #

@router.patch("/{image_id}/rating", response_model=ImageOut)
def update_rating(
    image_id: int, body: RatingUpdate, db: Session = Depends(get_db)
):
    if not (1 <= body.rating <= 5):
        raise HTTPException(status_code=400, detail="Rating must be 1-5")
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    img.rating = body.rating
    db.commit()
    db.refresh(img)
    return img


# ------------------------------------------------------------------ #
# DELETE /api/images/{id}                                               #
# ------------------------------------------------------------------ #

@router.delete("/{image_id}", status_code=204)
def delete_image(image_id: int, db: Session = Depends(get_db)):
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    db.delete(img)
    db.commit()
