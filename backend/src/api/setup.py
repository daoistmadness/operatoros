from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import settings
from security.setup_authorization import COOKIE_NAME, issue_setup_authorization, validate_setup_authorization
from services.first_admin_provisioning import ProvisioningError, get_setup_status, provision_first_admin


router = APIRouter()


class SetupStatusResponse(BaseModel):
    setup_required: bool
    setup_token_required: bool


class FirstAdminRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)
    password_confirmation: str = Field(min_length=1, max_length=1024)


class FirstAdminResponse(BaseModel):
    id: int
    username: str
    role: str


def _error(exc: ProvisioningError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": str(exc)})


@router.get("/status", response_model=SetupStatusResponse)
def setup_status(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    result = get_setup_status(db)
    return SetupStatusResponse(**result.__dict__)


@router.post("/bootstrap", status_code=status.HTTP_204_NO_CONTENT)
def bootstrap_setup(request: Request, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    if not get_setup_status(db).setup_required:
        raise _error(ProvisioningError("SETUP_ALREADY_COMPLETED", "Initial administrator setup has already been completed.", 409))
    try:
        authorization = issue_setup_authorization(
            configuration=settings,
            client_host=request.client.host if request.client else None,
            origin=request.headers.get("origin"),
        )
    except ProvisioningError as exc:
        raise _error(exc) from exc
    response.set_cookie(
        COOKIE_NAME,
        authorization,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        max_age=300,
        path="/api/setup",
    )


@router.post("/admin", response_model=FirstAdminResponse, status_code=status.HTTP_201_CREATED)
def create_first_admin(body: FirstAdminRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    if body.password != body.password_confirmation:
        raise HTTPException(
            status_code=400,
            detail={"code": "PASSWORD_CONFIRMATION_MISMATCH", "message": "Password confirmation does not match."},
        )
    try:
        setup_token = validate_setup_authorization(request.cookies.get(COOKIE_NAME), configuration=settings)
        user = provision_first_admin(
            db,
            username=body.username,
            password=body.password,
            setup_token=setup_token,
            provisioning_source="WEB_SETUP",
            require_setup_token=True,
            user_agent=request.headers.get("user-agent"),
            ip_address=request.client.host if request.client else None,
        )
    except ProvisioningError as exc:
        raise _error(exc) from exc
    response.delete_cookie(COOKIE_NAME, path="/api/setup", httponly=True, samesite="strict")
    return FirstAdminResponse(id=user.id, username=user.username, role=user.role)
