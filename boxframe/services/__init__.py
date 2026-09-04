__all__ = ["LayoutService", "PseudoGraphicRenderer"]

# Lazy imports to avoid circular dependencies
def __getattr__(name):
    if name == "LayoutService":
        from boxframe.services.layout_service import LayoutService
        return LayoutService
    if name == "PseudoGraphicRenderer":
        from boxframe.services.renderer import PseudoGraphicRenderer
        return PseudoGraphicRenderer
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
