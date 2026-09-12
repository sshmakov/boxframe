from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "boxframe"
    database_url: str = "sqlite+aiosqlite:///./boxframe.db"
    debug: bool = False
    log_dir: str = "log"

    class Config:
        env_prefix = "BOXFRAME_"


settings = Settings()
