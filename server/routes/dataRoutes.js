const express = require('express');
const router = express.Router();
const {
  getStatusFields,
  saveStatusField,
  deleteStatusField,
} = require('../controllers/fieldDataController');
const { recordData, getStatusRecords } = require('../controllers/recordData');
const { getPatients, savePatient, deletePatient } = require('../controllers/patientController');
const { getPatientReport } = require('../controllers/reportController');

router.get('/status-fields', getStatusFields);
router.post('/status-fields', saveStatusField);
router.delete('/status-fields/:screenKey/:fieldKey', deleteStatusField);

router.post('/status-records', recordData);
router.get('/status-records', getStatusRecords);

router.get('/patients', getPatients);
router.post('/patients', savePatient);
router.delete('/patients/:id', deletePatient);

router.get('/status-report', getPatientReport);

module.exports = router;
