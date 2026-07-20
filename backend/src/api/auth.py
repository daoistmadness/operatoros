from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from models.user import User
from security.dependencies import get_current_user
from security.capabilities import capabilities_for_role
from security.sessions import SESSION_COOKIE_NAME
from services.auth_service import AuthenticationFailure, authenticate_user, logout_user


router = APIRouter()


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)


class CurrentUserResponse(BaseModel):
    id: int
    username: str
    role: str
    capabilities: list[str]


def _current_user_response(user: User) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        capabilities=sorted(capabilities_for_role(user.role)),
    )


def _request_context(request: Request) -> tuple[str | None, str | None]:
    user_agent = request.headers.get("user-agent")
    ip_address = request.client.host if request.client else None
    return user_agent, ip_address


@router.post("/login", response_model=CurrentUserResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    user_agent, ip_address = _request_context(request)
    try:
        result = authenticate_user(
            db,
            username=body.username,
            password=body.password,
            user_agent=user_agent,
            ip_address=ip_address,
        )
    except AuthenticationFailure as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    max_age = settings.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=result.token,
        max_age=max_age,
        expires=max_age,
        path="/",
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    return _current_user_response(result.user)


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
):
    user_agent, ip_address = _request_context(request)
    logout_user(db, token=token, user_agent=user_agent, ip_address=ip_address)
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return None


@router.get("/me", response_model=CurrentUserResponse)
def current_user(user: User = Depends(get_current_user)):
    return _current_user_response(user)
