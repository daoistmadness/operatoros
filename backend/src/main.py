# main.py
# FastAPI application entry point.
# Tech Stack: FastAPI / Python 3.12

from contextlib import asynccontextmanager
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.academic_config import router as academic_config_router
from api.academic_interventions import router as academic_interventions_router
from api.analytics import router as analytics_router
from api.report_builder import router as report_builder_router
from api.reports import router as reports_router
from api.backups import router as backups_router
from api.auth import router as auth_router
from api.setup import router as setup_router
from api.config import router as config_router
from api.grades import router as grades_router
from api.students import router as students_router
from api.student_masters import router as student_masters_router
from api.student_enrollments import router as student_enrollments_router
from api.uploads import router as uploads_router
from api.system import router as system_router
from api.review import router as review_router
from core.database import init_db

from core.config import settings
from services.backup_scheduler import backup_scheduler

# Authentication is fail-closed: every worker must receive the same persistent secret.
settings.require_auth_cookie_secret()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    backup_scheduler.start()
    try:
        yield
    finally:
        backup_scheduler.stop()

app = FastAPI(
    title="School Attendance Analytics",
    version="0.9.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS — configured for Vite dev server, Docker, and any custom origins via ALLOWED_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables on startup
init_db()

# Canonical /api/* routers — all frontend requests use these paths.
# The Vite dev proxy forwards /api/* to http://127.0.0.1:8000/api/*.
app.include_router(analytics_router, prefix="/api/analytics", tags=["analytics"])
app.include_router(config_router, prefix="/api/config", tags=["config"])
app.include_router(students_router, prefix="/api/students", tags=["students"])
app.include_router(student_masters_router, prefix="/api/student-masters", tags=["student-masters"])
app.include_router(student_enrollments_router, prefix="/api/student-enrollments", tags=["student-enrollments"])
app.include_router(uploads_router, prefix="/api/uploads", tags=["uploads"])
app.include_router(system_router, prefix="/api/system", tags=["system"])
app.include_router(review_router, prefix="/api/review", tags=["review"])
app.include_router(grades_router, prefix="/api/grades", tags=["grades"])
app.include_router(academic_config_router, prefix="/api/academic-config", tags=["academic-config"])
app.include_router(academic_interventions_router, prefix="/api/academic-interventions", tags=["academic-interventions"])
app.include_router(report_builder_router, prefix="/api/report-builder", tags=["report-builder"])
app.include_router(reports_router, prefix="/api/reports", tags=["reports"])
app.include_router(backups_router, prefix="/api/admin/backups", tags=["admin-backups"])
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(setup_router, prefix="/api/setup", tags=["setup"])



# Legacy bare-path aliases — retained for backward compatibility with direct curl/Swagger usage.
# New frontend code must use the /api/* canonical routes above.
app.include_router(analytics_router, prefix="/analytics", tags=["analytics-legacy"])
app.include_router(students_router, prefix="/students", tags=["students-legacy"])


@app.get("/health", tags=["health"])
def health_check() -> dict:
    """Health check endpoint used by the desktop launcher and monitoring."""
    return {
        "status": "ok",
        "service": "operatoros-sidecar",
        "version": os.environ.get("OPERATOROS_VERSION", app.version),
    }


@app.get("/", tags=["health"])
def read_root() -> dict:
    return {"status": "ok", "message": "School Attendance Analytics API"}
