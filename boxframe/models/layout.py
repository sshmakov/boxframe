import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from boxframe.database import Base


class Layout(Base):
    __tablename__ = "layouts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Optional: a layout may have a width, a height, both, or neither.
    # A set dimension is a visual bounds line in the editor — it does not
    # constrain block placement or the canvas size.
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    project: Mapped["Project"] = relationship(back_populates="layouts")
    blocks: Mapped[list["Block"]] = relationship(
        back_populates="layout",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
