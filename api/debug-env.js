module.exports = async (req, res) => {
  const apiKey = process.env.SEAM_API_KEY || '';
  const deviceId = process.env.SEAM_DEVICE_ID || '';

  return res.status(200).json({
    seam_api_key_present: apiKey.length > 0,
    seam_api_key_length: apiKey.length,
    seam_api_key_starts_with: apiKey.slice(0, 10),
    seam_api_key_ends_with: apiKey.slice(-4),
    seam_api_key_has_whitespace: /\s/.test(apiKey),
    seam_device_id: deviceId,
    seam_device_id_length: deviceId.length,
    seam_device_id_has_whitespace: /\s/.test(deviceId),
  });
};
