module.exports = async (req, res) => {
  const apiKey = process.env.SEAM_API_KEY || '';
  const deviceId = process.env.SEAM_DEVICE_ID || '';

  let workspaceCheck = null;
  try {
    const wsRes = await fetch('https://connect.getseam.com/workspaces/get', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const wsData = await wsRes.json();
    workspaceCheck = { ok: wsRes.ok, status: wsRes.status, data: wsData };
  } catch (err) {
    workspaceCheck = { ok: false, error: err.message };
  }

  return res.status(200).json({
    seam_api_key_present: apiKey.length > 0,
    seam_api_key_length: apiKey.length,
    seam_api_key_starts_with: apiKey.slice(0, 10),
    seam_api_key_ends_with: apiKey.slice(-4),
    seam_api_key_has_whitespace: /\s/.test(apiKey),
    seam_device_id: deviceId,
    seam_device_id_length: deviceId.length,
    seam_device_id_has_whitespace: /\s/.test(deviceId),
    workspace_check: workspaceCheck,
  });
};
