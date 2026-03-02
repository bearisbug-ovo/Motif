from datetime import datetime
from pydantic import BaseModel


class ImageOut(BaseModel):
    id: int
    filepath: str
    character_id: int | None
    action_id: int | None
    prompt: str
    model: str
    seed: int
    faceswapped: bool
    upscaled: bool
    inpainted: bool
    rating: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RatingUpdate(BaseModel):
    rating: int


class InpaintRequest(BaseModel):
    image_id: int
    prompt: str = ""
    mode: str = "flux"  # "flux" | "sdxl" | "klein"
    denoise: float | None = None
    seed: int = -1
