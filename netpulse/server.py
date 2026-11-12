import os

import uvicorn

from netpulse.app import create_app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("NETPULSE_PORT", "3001"))
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        reload=False,
    )
