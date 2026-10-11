"""
OCR engine module (Phase 2).
Uses PaddleOCR when available, with OpenCV preprocessing.
"""
import cv2
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    from paddleocr import PaddleOCR
    PADDLE_AVAILABLE = True
except ImportError:
    PADDLE_AVAILABLE = False

class OCREngine:
    def __init__(self, use_gpu: bool = False):
        self.ocr = None
        if PADDLE_AVAILABLE:
            try:
                self.ocr = PaddleOCR(use_angle_cls=True, lang='en', use_gpu=use_gpu, show_log=False)
            except Exception as e:
                print(f"PaddleOCR init failed: {e}")
                self.ocr = None

    def preprocess(self, image_path: str) -> np.ndarray:
        img = cv2.imread(image_path)
        if img is None:
            raise ValueError(f"Cannot load image: {image_path}")
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        return enhanced

    def extract_text(self, image_path: str) -> List[Dict[str, Any]]:
        if not self.ocr:
            return [{"text": "[OCR engine not available]", "confidence": 0.0, "bbox": None}]
        result = self.ocr.ocr(image_path, cls=True)
        extracted = []
        if result and result[0]:
            for line in result[0]:
                bbox, (text, conf) = line
                extracted.append({
                    "text": text,
                    "confidence": float(conf),
                    "bbox": bbox
                })
        return extracted

    def detect_plates(self, image_path: str) -> List[Dict]:
        return [{"plate_label": "Plate 1", "confidence": 0.5, "region": None}]
