import json
import tempfile
import unittest
from pathlib import Path

from engine.core.vs_usual import build_vs_usual, enrich_activity_files


def activity(sport="Run", duration=100, avg_hr=140, z4=10, z5=5, start="2026-01-01"):
    return {
        "sport_type": sport,
        "start_date_local": f"{start}T09:00:00",
        "elapsed_time": duration,
        "average_heartrate": avg_hr,
        "hr_zones": {"Zone 4": {"seconds": z4}, "Zone 5": {"seconds": z5}},
    }


class TestBuildVsUsual(unittest.TestCase):
    def test_requires_two_prior_sessions(self):
        self.assertIsNone(build_vs_usual([activity()]))

    def test_computes_medians_and_limits_to_last_twenty(self):
        prior = [activity(duration=i, avg_hr=i, z4=i, z5=0) for i in range(1, 22)]
        self.assertEqual(
            build_vs_usual(prior),
            {
                "duration_median_s": 11.5,
                "avg_hr_median": 11.5,
                "above_threshold_median_s": 11.5,
            },
        )

    def test_each_metric_requires_two_valid_observations(self):
        first = activity(duration=100, avg_hr=140)
        second = activity(duration=200, avg_hr=None)
        second.pop("hr_zones")
        self.assertEqual(
            build_vs_usual([first, second]),
            {
                "duration_median_s": 150,
            },
        )

    def test_metrics_use_their_own_valid_observations(self):
        first = activity(duration=100, avg_hr=140, z4=10, z5=5)
        second = activity(duration=200, avg_hr=None, z4=20, z5=10)
        third = activity(duration=None, avg_hr=160)
        third.pop("hr_zones")
        self.assertEqual(
            build_vs_usual([first, second, third]),
            {
                "duration_median_s": 150,
                "avg_hr_median": 150,
                "above_threshold_median_s": 22.5,
            },
        )

    def test_returns_none_when_two_priors_have_no_valid_metrics(self):
        prior = [
            activity(duration="invalid", avg_hr=None, z4=None, z5=None),
            activity(duration="invalid", avg_hr=None, z4=None, z5=None),
        ]
        self.assertIsNone(build_vs_usual(prior))


class TestEnrichActivityFiles(unittest.TestCase):
    def test_enriches_only_changed_file_from_prior_same_sport(self):
        with tempfile.TemporaryDirectory() as temp:
            history = Path(temp)
            paths = []
            records = [
                activity(duration=100, start="2026-01-01"),
                activity(sport="Ride", duration=999, start="2026-01-02"),
                activity(duration=200, start="2026-01-03"),
                activity(duration=300, start="2026-01-04"),
            ]
            for index, record in enumerate(records):
                path = history / f"{index}.json"
                path.write_text(json.dumps(record))
                paths.append(path)

            self.assertEqual(enrich_activity_files(history, [paths[-1]]), 1)
            enriched = json.loads(paths[-1].read_text())
            self.assertEqual(
                enriched["vs_usual"],
                {
                    "above_threshold_median_s": 15,
                    "avg_hr_median": 140,
                    "duration_median_s": 150,
                },
            )
            self.assertNotIn("vs_usual", json.loads(paths[0].read_text()))

    def test_does_not_write_when_two_priors_have_no_valid_metrics(self):
        with tempfile.TemporaryDirectory() as temp:
            history = Path(temp)
            paths = []
            records = [
                activity(duration="invalid", avg_hr=None, z4=None, z5=None, start="2026-01-01"),
                activity(duration="invalid", avg_hr=None, z4=None, z5=None, start="2026-01-02"),
                activity(start="2026-01-03"),
            ]
            for index, record in enumerate(records):
                path = history / f"{index}.json"
                path.write_text(json.dumps(record))
                paths.append(path)

            self.assertEqual(enrich_activity_files(history, [paths[-1]]), 0)
            self.assertNotIn("vs_usual", json.loads(paths[-1].read_text()))

    def test_batch_uses_earlier_new_activity_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            history = Path(temp)
            paths = []
            for index, duration in enumerate((100, 200, 300)):
                record = activity(duration=duration, start=f"2026-01-0{index + 1}")
                path = history / f"{index}.json"
                path.write_text(json.dumps(record))
                paths.append(path)

            self.assertEqual(enrich_activity_files(history, paths[1:]), 1)
            self.assertNotIn("vs_usual", json.loads(paths[1].read_text()))
            self.assertEqual(
                json.loads(paths[2].read_text())["vs_usual"]["duration_median_s"], 150
            )
            self.assertEqual(enrich_activity_files(history, paths[1:]), 0)


if __name__ == "__main__":
    unittest.main()
