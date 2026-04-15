from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
import asyncio

from src.api.v1 import search, patients, pipelines, register, auth
from src.services.job_watcher import watch_jobs_loop
from src.services.auth_dependencies import verify_token

app = FastAPI(title="Genomic RAG Engine", version="1.0.0")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(watch_jobs_loop())

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])

# Protect all other routes
dependencies = [Depends(verify_token)]

app.include_router(search.router, prefix="/api/v1", tags=["search"], dependencies=dependencies)
app.include_router(patients.router, prefix="/api/v1/patients", tags=["patients"], dependencies=dependencies)
app.include_router(pipelines.router, prefix="/api/v1/pipelines", tags=["pipelines"], dependencies=dependencies)
app.include_router(register.router, prefix="/api/v1", tags=["register"], dependencies=dependencies)


@app.get("/health")
def health_check():
    from src.config import settings
    return {"status": "active", "system": "Genomic RAG Engine", "mode": settings.processing_mode}
