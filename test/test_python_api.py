import pytest
from fastapi.testclient import TestClient

from netpulse.app import create_app


@pytest.fixture
def inspector():
    class FakeInspector:
        def get_interfaces(self):
            return [{"name": "Wi-Fi", "status": "Up"}]

        def get_ports(self):
            return [{"protocol": "TCP", "port": 3000, "pid": 42}]

        def get_routes(self):
            return [{"destination": "0.0.0.0/0"}]

    return FakeInspector()


@pytest.fixture
def client(inspector):
    return TestClient(create_app(inspector))


def test_api_exposes_read_only_interfaces_ports_and_routes(client):
    assert client.get("/api/interfaces").json() == [
        {"name": "Wi-Fi", "status": "Up"}
    ]
    assert client.get("/api/ports").json() == [
        {"protocol": "TCP", "port": 3000, "pid": 42}
    ]
    assert client.get("/api/routes").json() == [
        {"destination": "0.0.0.0/0"}
    ]


def test_api_rejects_unsupported_methods(client):
    response = client.post("/api/ports")

    assert response.status_code == 405
    assert response.headers["allow"] == "GET"
    assert response.json() == {"error": "Method not allowed"}


def test_unknown_api_path_returns_json_404(client):
    response = client.get("/api/other")

    assert response.status_code == 404
    assert response.json() == {"error": "Not found"}


def test_inspection_errors_return_generic_service_error():
    class BrokenInspector:
        def get_interfaces(self):
            raise RuntimeError("private internal detail")

    client = TestClient(create_app(BrokenInspector()))
    response = client.get("/api/interfaces")

    assert response.status_code == 500
    assert response.json() == {
        "error": "Unable to inspect local network data"
    }
    assert "private internal detail" not in response.text


def test_dashboard_homepage_is_served(client):
    response = client.get("/")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "NetPulse" in response.text


def test_powered_by_header_is_not_exposed(client):
    response = client.get("/api/interfaces")

    assert "x-powered-by" not in response.headers
