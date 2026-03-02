from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    character_id: int | None = None
    prompt: str
    model: str = Field(default="turbo", pattern="^(turbo|base)$")
    width: int = 768
    height: int = 1024
    seed: int = -1  # -1 = random
    faceswap: bool = False
    upscale: bool = False


class TaskStatus(BaseModel):
    task_id: str
    stage: str  # preprocessing | generating | faceswapping | upscaling | done | error
    progress: int
    image_url: str | None = None
    error: str | None = None


class TaskMeta(BaseModel):
    """Full task entry for the task-list view."""
    task_id: str
    character_id: int | None
    character_name: str | None
    prompt: str
    model: str
    faceswap: bool
    upscale: bool
    created_at: str
    # runtime status
    stage: str
    progress: int
    image_url: str | None = None
    error: str | None = None
