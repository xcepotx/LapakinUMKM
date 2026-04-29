"""Routes package — exposes a list of routers for server.py to mount."""
from .auth import router as auth_router
from .shops import router as shops_router
from .products import router as products_router
from .ai import router as ai_router
from .og import router as og_router
from .whatsapp import router as whatsapp_router
from .public import router as public_router
from .admin import router as admin_router

ALL_ROUTERS = [
    auth_router,
    shops_router,
    products_router,
    ai_router,
    og_router,
    whatsapp_router,
    public_router,
    admin_router,
]
