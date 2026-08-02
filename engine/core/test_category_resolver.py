import unittest
from engine.core.category_resolver import resolve_category, resolve_from_activity

class TestCategoryResolver(unittest.TestCase):
    def setUp(self):
        self.array_config = [
            {
                "sport": "Badminton",
                "categories": [
                    { "code": "RNK", "label": "Ranked", "rule": { "weekday": "Mon" } },
                    { "code": "FRN", "label": "Friendly", "rule": { "weekday": "Thu" } },
                    { "code": "CAS", "label": "Casual" }
                ]
            },
            {
                "sport": "WeightTraining",
                "categories": [
                    { "code": "FDN", "label": "Foundation", "rule": { "duration_lt": 1500 } },
                    { "code": "CAL", "label": "Calisthenics" }
                ]
            },
            {
                "sport": "Run",
                "categories": [
                    { "code": "LNG", "label": "Long Run", "rule": { "duration_gte": 2400 } },
                    { "code": "SPR", "label": "Sprint", "rule": { "duration_lt": 1200 } },
                    { "code": "EZR", "label": "Easy Run" }
                ]
            }
        ]
        self.dict_config = {
            "Badminton": {
                "RNK": { "label": "Ranked", "rule": { "weekday": "Mon" } },
                "FRN": { "label": "Friendly", "rule": { "weekday": "Thu" } },
                "CAS": { "label": "Casual" }
            },
            "WeightTraining": {
                "FDN": { "label": "Foundation", "rule": { "duration_lt": 1500 } },
                "CAL": { "label": "Calisthenics" }
            },
            "Run": {
                "LNG": { "label": "Long Run", "rule": { "duration_gte": 2400 } },
                "SPR": { "label": "Sprint", "rule": { "duration_lt": 1200 } },
                "EZR": { "label": "Easy Run" }
            }
        }

    def test_array_config_badminton_resolution(self):
        # Mon -> RNK
        cat_mon = resolve_category("Badminton", 3600, "2026-08-03T19:00:00", self.array_config)
        self.assertEqual(cat_mon, "RNK")

        # Thu -> FRN
        cat_thu = resolve_category("Badminton", 3600, "2026-08-06T19:00:00", self.array_config)
        self.assertEqual(cat_thu, "FRN")

        # Tue -> CAS (catch-all default)
        cat_tue = resolve_category("Badminton", 3600, "2026-08-04T19:00:00", self.array_config)
        self.assertEqual(cat_tue, "CAS")

    def test_array_config_weight_training(self):
        # < 1500 -> FDN
        cat_fdn = resolve_category("WeightTraining", 1200, "2026-08-01T10:00:00", self.array_config)
        self.assertEqual(cat_fdn, "FDN")

        # >= 1500 -> CAL
        cat_cal = resolve_category("WeightTraining", 1800, "2026-08-01T10:00:00", self.array_config)
        self.assertEqual(cat_cal, "CAL")

    def test_array_config_run(self):
        # >= 2400 -> LNG
        cat_lng = resolve_category("Run", 3000, "2026-08-01T08:00:00", self.array_config)
        self.assertEqual(cat_lng, "LNG")

        # < 1200 -> SPR
        cat_spr = resolve_category("Run", 900, "2026-08-01T08:00:00", self.array_config)
        self.assertEqual(cat_spr, "SPR")

        # In-between -> EZR
        cat_ezr = resolve_category("Run", 1800, "2026-08-01T08:00:00", self.array_config)
        self.assertEqual(cat_ezr, "EZR")

    def test_array_config_unknown_sport(self):
        cat_unk = resolve_category("Basketball", 1800, "2026-08-01T08:00:00", self.array_config)
        self.assertEqual(cat_unk, "BAS")

    def test_dict_config_badminton_resolution(self):
        # Mon -> RNK
        cat_mon = resolve_category("Badminton", 3600, "2026-08-03T19:00:00", self.dict_config)
        self.assertEqual(cat_mon, "RNK")

        # Thu -> FRN
        cat_thu = resolve_category("Badminton", 3600, "2026-08-06T19:00:00", self.dict_config)
        self.assertEqual(cat_thu, "FRN")

        # Tue -> CAS (catch-all default)
        cat_tue = resolve_category("Badminton", 3600, "2026-08-04T19:00:00", self.dict_config)
        self.assertEqual(cat_tue, "CAS")

    def test_dict_config_weight_training(self):
        # < 1500 -> FDN
        cat_fdn = resolve_category("WeightTraining", 1200, "2026-08-01T10:00:00", self.dict_config)
        self.assertEqual(cat_fdn, "FDN")

        # >= 1500 -> CAL
        cat_cal = resolve_category("WeightTraining", 1800, "2026-08-01T10:00:00", self.dict_config)
        self.assertEqual(cat_cal, "CAL")

    def test_dict_config_run(self):
        # >= 2400 -> LNG
        cat_lng = resolve_category("Run", 3000, "2026-08-01T08:00:00", self.dict_config)
        self.assertEqual(cat_lng, "LNG")

        # < 1200 -> SPR
        cat_spr = resolve_category("Run", 900, "2026-08-01T08:00:00", self.dict_config)
        self.assertEqual(cat_spr, "SPR")

        # In-between -> EZR
        cat_ezr = resolve_category("Run", 1800, "2026-08-01T08:00:00", self.dict_config)
        self.assertEqual(cat_ezr, "EZR")

    def test_dict_config_unknown_sport(self):
        cat_unk = resolve_category("Basketball", 1800, "2026-08-01T08:00:00", self.dict_config)
        self.assertEqual(cat_unk, "BAS")

if __name__ == "__main__":
    unittest.main()
