import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException


logger = logging.getLogger("netpulse")

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"


def create_app(inspector=None):
    if inspector is None:
        from netpulse.inspector import SystemInspector

        inspector = SystemInspector()

    app = FastAPI(
        title="NetPulse Local",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request, exc):
        if request.url.path.startswith("/api/"):
            if exc.status_code == 405:
                headers = dict(exc.headers or {})
                headers["Allow"] = "GET"
                return JSONResponse(
                    status_code=405,
                    content={"error": "Method not allowed"},
                    headers=headers,
                )
            if exc.status_code == 500:
                return JSONResponse(
                    status_code=500,
                    content={"error": "Unable to inspect local network data"},
                )
            if exc.status_code == 404:
                return JSONResponse(
                    status_code=404,
                    content={"error": "Not found"},
                    headers=exc.headers,
                )

        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )

    def read_network_data(method_name):
        try:
            method = getattr(inspector, method_name)
            return method()
        except Exception:
            logger.exception("Network inspection failed")
            raise HTTPException(
                status_code=500,
                detail="Unable to inspect local network data",
            )

    @app.get("/api/interfaces")
    def get_interfaces():
        return read_network_data("get_interfaces")

    @app.get("/api/ports")
    def get_ports():
        return read_network_data("get_ports")

    @app.get("/api/routes")
    def get_routes():
        return read_network_data("get_routes")

    @app.get("/api/{path:path}")
    def unknown_api_path(path: str):
        return JSONResponse(
            status_code=404,
            content={"error": "Not found"},
        )

    app.mount(
        "/",
        StaticFiles(directory=str(PUBLIC_DIR), html=True),
        name="static",
    )

    return app
