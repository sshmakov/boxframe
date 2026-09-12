"""boxframe — Pseudo-graphic UI mockup editor for AI agents."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("boxframe")
except PackageNotFoundError:  # installed without metadata (e.g. run from source)
    __version__ = "0.0.0"
