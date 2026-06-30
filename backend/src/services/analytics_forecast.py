from __future__ import annotations

from statistics import mean


VALID_FORECAST_METHODS = {"moving_average", "weighted_moving_average", "linear_trend"}


def _confidence_for_points(point_count: int) -> tuple[str, str, str | None]:
    if point_count < 2:
        return "none", "insufficient", "Fewer than 2 historical periods available."
    if point_count == 2:
        return "low", "limited", "Only 2 historical periods available."
    if point_count <= 5:
        return "medium", "adequate", f"{point_count} historical periods available."
    return "higher", "adequate", f"{point_count} historical periods available; forecast remains an estimate."


def forecast_metric(
    metric: str,
    values: list[float | int | None],
    *,
    period: str = "next_term",
    method: str = "linear_trend",
    minimum: float | None = None,
    maximum: float | None = None,
) -> dict:
    clean_values = [float(value) for value in values if value is not None]
    history_points = len(clean_values)
    confidence, sufficiency, warning = _confidence_for_points(history_points)

    if history_points < 2:
        return {
            "metric": metric,
            "period": period,
            "forecast_value": None,
            "method": "none",
            "history_points": history_points,
            "confidence": confidence,
            "data_sufficiency": sufficiency,
            "warning": warning,
        }

    if method not in VALID_FORECAST_METHODS:
        method = "linear_trend"

    if method == "moving_average":
        window = clean_values[-min(3, history_points):]
        forecast_value = mean(window)
    elif method == "weighted_moving_average":
        window = clean_values[-min(3, history_points):]
        weights = list(range(1, len(window) + 1))
        forecast_value = sum(value * weight for value, weight in zip(window, weights)) / sum(weights)
    else:
        x_values = list(range(history_points))
        x_mean = mean(x_values)
        y_mean = mean(clean_values)
        denominator = sum((x - x_mean) ** 2 for x in x_values)
        if denominator == 0:
            forecast_value = clean_values[-1]
            method = "last_observation_fallback"
        else:
            slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_values, clean_values)) / denominator
            intercept = y_mean - slope * x_mean
            forecast_value = intercept + slope * history_points

    if minimum is not None:
        forecast_value = max(minimum, forecast_value)
    if maximum is not None:
        forecast_value = min(maximum, forecast_value)

    return {
        "metric": metric,
        "period": period,
        "forecast_value": round(float(forecast_value), 1),
        "method": method,
        "history_points": history_points,
        "confidence": confidence,
        "data_sufficiency": sufficiency,
        "warning": warning,
    }


def build_forecast_series(history: dict[str, list[float | int | None]], method: str = "linear_trend") -> list[dict]:
    bounded_percent_metrics = {"attendance_percentage", "sumatif_average", "formatif_average"}
    count_metrics = {"late_days", "late_minutes", "below_kkm_alert_count", "open_intervention_count"}
    forecasts = []
    for metric, values in history.items():
        forecasts.append(
            forecast_metric(
                metric,
                values,
                method=method,
                minimum=0.0 if metric in bounded_percent_metrics or metric in count_metrics else None,
                maximum=100.0 if metric in bounded_percent_metrics else None,
            )
        )
    return forecasts
