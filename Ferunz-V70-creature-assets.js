/**
 * FERUNZ STUDIO — V70 creature generation/asset pipeline
 * Framework-free orchestration layer. It does not assume a specific image provider.
 */
(function (root) {
  'use strict';
  var Studio = root.FerunzCreatureStudio;
  if (!Studio) throw new Error('FerunzCreatureStudio must be loaded first');

  function idPart(v) {
    return String(v == null ? '' : v).trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'creature';
  }
  function now() { return new Date().toISOString(); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function createAssetRecord(creature, options) {
    options = options || {};
    var c = Studio.normalizeCreature(creature);
    var id = options.id || ('creature-' + idPart(c.name) + '-' + c.generation.gen + '-' + c.generation.vr);
    return {
      id: id,
      entityType: 'creature',
      name: c.name,
      status: 'draft',
      prompt: Studio.creaturePrompt(c),
      creature: c,
      angles: Studio.ANGLES.slice(),
      assets: {},
      createdAt: now(),
      updatedAt: now(),
      metadata: {
        source: options.source || 'ferunz-creature-studio-v70',
        version: options.version || 'V70'
      }
    };
  }

  function setStatus(record, status) {
    var allowed = ['draft','queued','generating','ready','partial','failed'];
    if (allowed.indexOf(status) < 0) throw new Error('Invalid creature asset status: ' + status);
    record.status = status;
    record.updatedAt = now();
    return record;
  }

  function attachAngleAsset(record, angle, asset) {
    var a = Studio.ANGLES.indexOf(Number(angle)) >= 0 ? Number(angle) : null;
    if (a === null) throw new Error('Creature assets must use one of the 8 V70 angles');
    if (!asset || !asset.uri) throw new Error('Angle asset requires a uri');
    record.assets[String(a)] = {
      uri: String(asset.uri),
      mimeType: asset.mimeType || 'image/*',
      provider: asset.provider || 'unknown',
      width: asset.width || null,
      height: asset.height || null,
      createdAt: asset.createdAt || now()
    };
    var count = Object.keys(record.assets).length;
    record.status = count === Studio.ANGLES.length ? 'ready' : 'partial';
    record.updatedAt = now();
    return record;
  }

  function getAngleAsset(record, angle) {
    var a = Studio.ANGLES.indexOf(Number(angle)) >= 0 ? Number(angle) : Studio.ANGLES[0];
    return record && record.assets ? (record.assets[String(a)] || null) : null;
  }

  function missingAngles(record) {
    return Studio.ANGLES.filter(function (a) { return !getAngleAsset(record, a); });
  }

  function buildGenerationRequest(creature, options) {
    options = options || {};
    var c = Studio.normalizeCreature(creature);
    var record = createAssetRecord(c, options);
    setStatus(record, 'queued');
    return {
      assetId: record.id,
      entityType: 'creature',
      prompt: record.prompt,
      negativePrompt: options.negativePrompt || 'duplicate heads, duplicate limbs, malformed anatomy, extra wings, extra tails, cropped creature, text, watermark',
      angles: Studio.ANGLES.slice(),
      generation: clone(c.generation),
      creature: clone(c),
      requestedAt: now()
    };
  }

  function generate(provider, creature, options) {
    options = options || {};
    if (!provider || typeof provider.generate !== 'function') {
      return Promise.reject(new Error('Creature generation provider must expose generate(request)'));
    }
    var request = buildGenerationRequest(creature, options);
    var record = createAssetRecord(creature, { id: request.assetId, source: options.source, version: options.version });
    markGenerating(record);
    return Promise.resolve(provider.generate(request)).then(function (result) {
      result = result || {};
      var angles = Array.isArray(result.assets) ? result.assets : [];
      angles.forEach(function (item) {
        if (item && item.angle != null && item.uri) attachAngleAsset(record, item.angle, item);
      });
      if (record.status !== 'ready' && options.requireAll !== false) {
        var missing = missingAngles(record);
        if (missing.length) {
          record.missingAngles = missing;
          record.status = 'partial';
        }
      }
      return record;
    }).catch(function (error) {
      markFailed(record, error && error.message ? error.message : error);
      throw error;
    });
  }

  function markGenerating(record) { return setStatus(record, 'generating'); }
  function markFailed(record, error) {
    record.error = String(error || 'Creature generation failed');
    return setStatus(record, 'failed');
  }

  function renderAsset(record, angle, options) {
    var asset = getAngleAsset(record, angle);
    return Studio.creatureTurntable(record.creature, angle, asset, options || {});
  }

  function toLibraryEntity(record) {
    return {
      id: record.id,
      type: 'creature',
      name: record.name,
      label: record.name,
      thumbnail: getAngleAsset(record, 0) ? getAngleAsset(record, 0).uri : null,
      status: record.status,
      creature: clone(record.creature),
      assetId: record.id
    };
  }

  root.FerunzCreatureAssets = {
    createAssetRecord: createAssetRecord,
    buildGenerationRequest: buildGenerationRequest,
    generate: generate,
    setStatus: setStatus,
    markGenerating: markGenerating,
    markFailed: markFailed,
    attachAngleAsset: attachAngleAsset,
    getAngleAsset: getAngleAsset,
    missingAngles: missingAngles,
    renderAsset: renderAsset,
    toLibraryEntity: toLibraryEntity
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FerunzCreatureAssets;
})(typeof globalThis !== 'undefined' ? globalThis : this);
