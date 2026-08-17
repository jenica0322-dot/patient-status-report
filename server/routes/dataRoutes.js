const express = require('express');
const router = express.Router();
const {
  getStatusFields,
  saveStatusField,
  deleteStatusField,
} = require('../controllers/fieldDataController');
const { recordData, getStatusRecords } = require('../controllers/recordData');
const { getPatients, getPatientAreas, savePatient, deletePatient } = require('../controllers/patientController');
const { getPatientReport, exportPatientReportExcel, exportPatientReportPdf } = require('../controllers/reportController');
const {
  uploadPhotos,
  getRecordPhotos,
  getReportPhotos,
  getPhotoFile,
  deletePhoto,
} = require('../controllers/photoController');
const { photoUpload } = require('../middleware/photoUpload');

// multer throws before the controller runs (file too large, too many files,
// non-image type) — without this it falls through to Express's default HTML
// error page instead of the JSON error response the frontend expects.
function handlePhotoUpload(req, res, next) {
  photoUpload.array('photos', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload failed' });
    next();
  });
}

router.get('/status-fields', getStatusFields);
router.post('/status-fields', saveStatusField);
router.delete('/status-fields/:screenKey/:fieldKey', deleteStatusField);

router.post('/status-records', recordData);
router.get('/status-records', getStatusRecords);

router.get('/patients/areas', getPatientAreas);
router.get('/patients', getPatients);
router.post('/patients', savePatient);
router.delete('/patients/:id', deletePatient);

router.get('/status-report', getPatientReport);
router.get('/status-report/export', exportPatientReportExcel);
router.get('/status-report/export-pdf', exportPatientReportPdf);
router.get('/status-report/photos', getReportPhotos);

router.post('/status-records/photos', handlePhotoUpload, uploadPhotos);
router.get('/status-records/photos', getRecordPhotos);
router.get('/photos/:id', getPhotoFile);
router.delete('/photos/:id', deletePhoto);

module.exports = router;
