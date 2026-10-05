/**
 * Program Modal Module for Polymorphic
 *
 * Handles program management UI: load, save, delete programs.
 * Simplified version from Noisedeck without collections.
 *
 * @module programModal
 */

import { programs } from './programs.js'
import { programImagesMigrated } from './programImages.js'

// DOM element references
let programModal = null
let programModalTitle = null

// Views
let loadProgramView = null
let saveProgramView = null
let deleteProgramView = null

// Load view elements
let programLoadSelect = null
let programLoadEmptyState = null
let programLoadBtn = null

// Save view elements
let programNameInput = null
let programOverwriteCheckbox = null
let programSaveBtn = null

// Delete view elements
let programDeleteSelect = null
let programDeleteEmptyState = null
let programDeleteCheckbox = null
let programDeleteBtn = null

// Callbacks
let prepareDsl = async dsl => dsl
let getDsl = null
let setDsl = null
let showToast = null

/**
 * Show a specific view in the program modal
 * @param {'load'|'save'|'delete'} view
 */
function showProgramView(view) {
    loadProgramView?.classList.remove('active')
    saveProgramView?.classList.remove('active')
    deleteProgramView?.classList.remove('active')

    if (view === 'load') {
        loadProgramView?.classList.add('active')
        if (programModalTitle) programModalTitle.textContent = 'load program'
        populateLoadSelect()
    } else if (view === 'save') {
        saveProgramView?.classList.add('active')
        if (programModalTitle) programModalTitle.textContent = 'save program'
        resetSaveView()
    } else if (view === 'delete') {
        deleteProgramView?.classList.add('active')
        if (programModalTitle) programModalTitle.textContent = 'delete program'
        populateDeleteSelect()
    }
}

/**
 * Populate load dropdown with saved programs
 */
function populateLoadSelect() {
    if (!programLoadSelect) return

    const names = programs.getNames()
    programLoadSelect.innerHTML = ''

    if (names.length === 0) {
        programLoadEmptyState?.classList.add('visible')
        if (programLoadBtn) programLoadBtn.disabled = true
    } else {
        programLoadEmptyState?.classList.remove('visible')
        if (programLoadBtn) programLoadBtn.disabled = false

        names.forEach(name => {
            const option = document.createElement('option')
            option.value = name
            option.textContent = name
            programLoadSelect.appendChild(option)
        })
    }
}

/**
 * Populate delete dropdown with saved programs
 */
function populateDeleteSelect() {
    if (!programDeleteSelect) return

    const names = programs.getNames()
    programDeleteSelect.innerHTML = ''

    if (names.length === 0) {
        programDeleteEmptyState?.classList.add('visible')
        if (programDeleteBtn) programDeleteBtn.disabled = true
    } else {
        programDeleteEmptyState?.classList.remove('visible')

        names.forEach(name => {
            const option = document.createElement('option')
            option.value = name
            option.textContent = name
            programDeleteSelect.appendChild(option)
        })
    }

    // Reset checkbox and button state
    if (programDeleteCheckbox) programDeleteCheckbox.checked = false
    if (programDeleteBtn) programDeleteBtn.disabled = true
}

/**
 * Reset save view to initial state
 */
function resetSaveView() {
    if (programNameInput) programNameInput.value = ''
    if (programOverwriteCheckbox) programOverwriteCheckbox.checked = false
    if (programSaveBtn) programSaveBtn.disabled = true
    // Hide overwrite checkbox initially
    const overwriteGroup = programOverwriteCheckbox?.closest('.control-group')
    if (overwriteGroup) overwriteGroup.style.display = 'none'
}

/**
 * Validate save button state
 */
function validateSaveButton() {
    if (!programNameInput || !programSaveBtn) return

    const name = programNameInput.value.trim()
    if (!name) {
        programSaveBtn.disabled = true
        return
    }

    const exists = programs.has(name)
    const overwriteGroup = programOverwriteCheckbox?.closest('.control-group')
    
    if (exists) {
        // Show overwrite checkbox
        if (overwriteGroup) overwriteGroup.style.display = ''
        if (!programOverwriteCheckbox?.checked) {
            programSaveBtn.disabled = true
        } else {
            programSaveBtn.disabled = false
        }
    } else {
        // Hide overwrite checkbox
        if (overwriteGroup) overwriteGroup.style.display = 'none'
        programSaveBtn.disabled = false
    }
}

/**
 * Open the program modal with a specific view
 * @param {'load'|'save'|'delete'} view
 */
export function openProgramModal(view) {
    if (!programModal) return
    showProgramView(view)
    programModal.showModal()
}

/**
 * Close the program modal
 */
export function closeProgramModal() {
    programModal?.close()
}

/**
 * Initialize the program modal module
 * @param {Object} options
 * @param {Function} options.getDsl - Function to get current DSL
 * @param {Function} [options.prepareDsl] - Stores the images a DSL uses and
 *   resolves with the DSL to save, which names them by reference
 * @param {Function} options.setDsl - Function to set DSL and recompile
 */
export function initProgramModal(options) {
    getDsl = options.getDsl
    setDsl = options.setDsl
    prepareDsl = options.prepareDsl || (async dsl => dsl)
    showToast = options.showToast || (typeof window !== 'undefined' ? window.showToast : null)

    // Cache DOM elements
    programModal = document.getElementById('programModal')
    programModalTitle = document.getElementById('programModalTitle')

    // Views
    loadProgramView = document.getElementById('loadProgramView')
    saveProgramView = document.getElementById('saveProgramView')
    deleteProgramView = document.getElementById('deleteProgramView')

    // Load view elements
    programLoadSelect = document.getElementById('programLoadSelect')
    programLoadEmptyState = document.getElementById('programLoadEmptyState')
    programLoadBtn = document.getElementById('programLoadBtn')

    // Save view elements
    programNameInput = document.getElementById('programNameInput')
    programOverwriteCheckbox = document.getElementById('programOverwriteCheckbox')
    programSaveBtn = document.getElementById('programSaveBtn')

    // Delete view elements
    programDeleteSelect = document.getElementById('programDeleteSelect')
    programDeleteEmptyState = document.getElementById('programDeleteEmptyState')
    programDeleteCheckbox = document.getElementById('programDeleteCheckbox')
    programDeleteBtn = document.getElementById('programDeleteBtn')

    // Set up event handlers
    setupEventHandlers()
}

/**
 * Set up all event handlers
 */
function setupEventHandlers() {
    // Close button
    const closeBtn = programModal?.querySelector('.program-modal-close')
    closeBtn?.addEventListener('click', () => {
        programModal?.close()
    })

    // Click outside to close
    programModal?.addEventListener('click', (e) => {
        if (e.target === programModal) {
            programModal.close()
        }
    })

    // Load button
    programLoadBtn?.addEventListener('click', () => {
        const name = programLoadSelect?.value
        if (!name) return

        const program = programs.get(name)
        if (program && setDsl) {
            setDsl(program.dsl, program.images || [])
            programModal?.close()
        }
    })

    // Save input validation
    programNameInput?.addEventListener('input', validateSaveButton)
    programOverwriteCheckbox?.addEventListener('change', validateSaveButton)

    // Save button
    programSaveBtn?.addEventListener('click', async () => {
        const name = programNameInput?.value?.trim()
        if (!name || !getDsl) return

        let dsl
        try {
            // Images first: a saved program must never name an image that is not stored.
            dsl = await prepareDsl(getDsl())
        } catch (error) {
            showToast?.(`Could not save program: ${error.message}`, 'error')
            return
        }
        // On a full localStorage there is room only once older entries'
        // images have moved out, which starts at page load.
        await programImagesMigrated()
        const res = programs.saveProgram(name, dsl)
        if (res && res.success === false) {
            if (res.quotaExceeded) {
                showToast?.('Could not save program: storage quota exceeded. Free up space by deleting unused programs.', 'error')
            } else {
                showToast?.('Could not save program: storage error', 'error')
            }
            return
        }
        programModal?.close()
        showToast?.(`Saved program "${name}"`, 'success')
    })

    // Delete checkbox enables button
    programDeleteCheckbox?.addEventListener('change', () => {
        if (programDeleteBtn) {
            programDeleteBtn.disabled = !programDeleteCheckbox?.checked
        }
    })

    // Delete button
    programDeleteBtn?.addEventListener('click', () => {
        const name = programDeleteSelect?.value
        if (!name) return

        const ok = programs.deleteProgram(name)
        if (!ok) {
            showToast?.(`Could not delete program "${name}"`, 'error')
            return
        }
        programModal?.close()
        showToast?.(`Deleted program "${name}"`, 'info')
    })
}
