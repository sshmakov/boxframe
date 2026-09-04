import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from boxframe.database import Base

# Supported block types
BLOCK_TYPES = [
    "box",        # Generic container
    "header",     # Page header
    "footer",     # Page footer
    "sidebar",    # Side column
    "content",    # Main content area
    "button",     # Button
    "input",      # Text input
    "textarea",   # Multi-line text area
    "image",      # Image placeholder
    "divider",    # Horizontal rule
    "text",       # Plain text
    "grid",       # Grid container
]

# Border styles
BORDER_STYLES = ["solid", "dashed", "dotted", "double", "none"]


class Block(Base):
    __tablename__ = "blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    layout_id: Mapped[str] = mapped_column(String(36), ForeignKey("layouts.id"), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("blocks.id"), nullable=True)
    block_type: Mapped[str] = mapped_column(String(32), nullable=False, default="box")
    x: Mapped[int] = mapped_column(Integer, default=0)
    y: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer, default=20)
    height: Mapped[int] = mapped_column(Integer, default=3)
    content: Mapped[str] = mapped_column(String(2000), default="")
    border_style: Mapped[str] = mapped_column(String(16), default="solid")
    metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    layout: Mapped["Layout"] = relationship(back_populates="blocks")
    parent: Mapped["Block | None"] = relationship(back_populates="children", remote_side=[id])
    children: Mapped[list["Block"]] = relationship(back_populates="parent", cascade="all, delete-orphan")
