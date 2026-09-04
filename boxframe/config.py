from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "boxframe"
    database_url: str = "sqlite+aiosqlite:///./boxframe.db"
    debug: bool = False

    class Config:
        env_prefix = "BOXFRAME_"


settings = Settings()
