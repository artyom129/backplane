import ipaddress
import socket
from urllib.parse import urlparse

from app.config import settings
from app.core.errors import AppError


def validate_outbound_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise AppError("invalid_url", "Only absolute HTTP and HTTPS URLs are allowed.")

    if parsed.username or parsed.password:
        raise AppError("invalid_url", "URLs containing embedded credentials are not allowed.")

    if settings.allow_private_networks:
        return url

    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise AppError(
            "host_unreachable", "The destination hostname could not be resolved."
        ) from exc

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise AppError(
                "private_network_blocked",
                "Requests to private or reserved network addresses are blocked.",
            )
    return url
