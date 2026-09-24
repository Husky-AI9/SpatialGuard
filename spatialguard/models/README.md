# Person detector

`yolo11n.onnx` is the existing SpatialGuard preview detector, exported from
Ultralytics YOLO11n with a static 640×640 input. It is included in the server
image so recorded incidents work without a manually provisioned model volume.
Camera recordings and credentials are not included.

Upstream source and export instructions: https://github.com/ultralytics/ultralytics
and https://docs.ultralytics.com/modes/export/ (ONNX, imgsz=640, dynamic=False).
The upstream AGPL-3.0 license is reproduced in `YOLO-LICENSE.txt`; this model
is not covered by the repository's MIT license. Model licensing remains part
of the existing publication review; packaging this preview does not resolve it.
