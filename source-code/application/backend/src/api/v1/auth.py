from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from src.services.auth_service import AuthService

router = APIRouter()
auth_service = AuthService()

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    username: str

@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    token = auth_service.authenticate_user(request.username, request.password)
    
    if not token:
        raise HTTPException(status_code=401, detail="Invalid username or password")
        
    return {"token": token, "username": request.username}
