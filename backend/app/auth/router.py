from fastapi import APIRouter, status

from app.api.dependencies import CurrentUser, SessionDep
from app.auth.schemas import (
    AuthResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserResponse,
)
from app.auth.service import (
    authenticate_user,
    issue_token_pair,
    register_user,
    revoke_refresh_token,
    rotate_refresh_token,
    user_response,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, session: SessionDep) -> AuthResponse:
    user = await register_user(
        session,
        email=payload.email,
        full_name=payload.full_name,
        password=payload.password,
        organization_name=payload.organization_name,
    )
    tokens = await issue_token_pair(session, user.id)
    await session.commit()
    return AuthResponse(user=await user_response(session, user), tokens=tokens)


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, session: SessionDep) -> AuthResponse:
    user = await authenticate_user(session, payload.email, payload.password)
    tokens = await issue_token_pair(session, user.id)
    await session.commit()
    return AuthResponse(user=await user_response(session, user), tokens=tokens)


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenPair:
    tokens = await rotate_refresh_token(session, payload.refresh_token)
    await session.commit()
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: LogoutRequest, session: SessionDep) -> None:
    await revoke_refresh_token(session, payload.refresh_token)
    await session.commit()


@router.get("/me", response_model=UserResponse)
async def current_user(user: CurrentUser, session: SessionDep) -> UserResponse:
    return await user_response(session, user)
