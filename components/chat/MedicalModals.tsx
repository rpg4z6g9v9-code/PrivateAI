/**
 * MedicalModals — Add Entry, Confirmation, and Appointment Summary modals.
 * Extracted from app/(tabs)/index.tsx.
 */

import React from 'react';
import {
  Modal, ScrollView, Share, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONT, cleanSummary } from '@/components/chat/types';
import {
  entryTypeLabel, entryTypeColor,
  type EntryDraft,
} from '@/services/medicalMemory';

export interface MedicalModalsProps {
  // Add modal
  addVisible: boolean;
  rawInput: string;
  extracting: boolean;
  onRawInputChange: (text: string) => void;
  onSubmit: () => void;
  onCloseAdd: () => void;
  // Confirm modal
  confirmVisible: boolean;
  pending: EntryDraft | null;
  urgent: boolean;
  onConfirm: () => void;
  onCloseConfirm: () => void;
  // Summary modal
  summaryVisible: boolean;
  summaryText: string;
  summaryLoading: boolean;
  onCloseSummary: () => void;
  onShare: () => void;
}

export default function MedicalModals(props: MedicalModalsProps) {
  const {
    addVisible, rawInput, extracting, onRawInputChange, onSubmit, onCloseAdd,
    confirmVisible, pending, urgent, onConfirm, onCloseConfirm,
    summaryVisible, summaryText, summaryLoading, onCloseSummary, onShare,
  } = props;

  return (
    <>
      {/* Add Entry Modal */}
      <Modal
        visible={addVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onCloseAdd}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>// log health entry</Text>
            <TouchableOpacity onPress={onCloseAdd}>
              <Text style={s.modalClose}>[cancel]</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.modalLabel}>describe what's happening</Text>
          <TextInput
            style={[s.modalInput, s.modalTextArea]}
            value={rawInput}
            onChangeText={onRawInputChange}
            placeholder="e.g. headache since this morning, mild, worse when I stand up..."
            placeholderTextColor="#333"
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoFocus
          />
          <Text style={s.medHint}>speak naturally — symptoms, medications, visits, lab results</Text>
          <TouchableOpacity
            onPress={onSubmit}
            style={[s.modalSaveBtn, { marginTop: 16 }]}
            disabled={!rawInput.trim() || extracting}>
            <Text style={s.modalSaveText}>{extracting ? 'extracting...' : 'extract & review'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        visible={confirmVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onCloseConfirm}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>// review entry</Text>
            <TouchableOpacity onPress={onCloseConfirm}>
              <Text style={s.modalClose}>[discard]</Text>
            </TouchableOpacity>
          </View>

          {urgent && (
            <View style={s.urgentBanner}>
              <Ionicons name="warning" size={16} color="#ff4444" />
              <Text style={s.urgentText}>  URGENT — if this is a medical emergency, call 911 immediately.</Text>
            </View>
          )}

          {pending && (
            <View style={s.confirmCard}>
              <View style={s.confirmRow}>
                <Text style={s.confirmLabel}>type</Text>
                <View style={[s.typeBadge, {
                  backgroundColor: entryTypeColor(pending.type) + '22',
                  borderColor: entryTypeColor(pending.type) + '66',
                }]}>
                  <Text style={[s.typeBadgeText, { color: entryTypeColor(pending.type) }]}>
                    {entryTypeLabel(pending.type)}
                  </Text>
                </View>
              </View>
              <View style={s.confirmRow}>
                <Text style={s.confirmLabel}>what</Text>
                <Text style={s.confirmValue} numberOfLines={3}>{pending.structured.what}</Text>
              </View>
              {pending.structured.severity && (
                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>severity</Text>
                  <Text style={s.confirmValue}>{pending.structured.severity}</Text>
                </View>
              )}
              {pending.structured.duration && (
                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>duration</Text>
                  <Text style={s.confirmValue}>{pending.structured.duration}</Text>
                </View>
              )}
              {pending.structured.context && (
                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>context</Text>
                  <Text style={s.confirmValue} numberOfLines={2}>{pending.structured.context}</Text>
                </View>
              )}
              {pending.tags.length > 0 && (
                <View style={s.tagsRow}>
                  {pending.tags.map(tag => (
                    <View key={tag} style={s.tag}>
                      <Text style={s.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          <Text style={s.privacyNote}>saved on-device only · zero data leaves device</Text>
          <TouchableOpacity onPress={onConfirm} style={[s.modalSaveBtn, { marginTop: 8 }]}>
            <Text style={s.modalSaveText}>save entry</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Appointment Summary Modal */}
      <Modal
        visible={summaryVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onCloseSummary}>
        <View style={s.summaryModal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>// appointment summary</Text>
            <TouchableOpacity onPress={onCloseSummary}>
              <Text style={s.modalClose}>[close]</Text>
            </TouchableOpacity>
          </View>

          <View style={s.apiWarning}>
            <Ionicons name="cloud-upload-outline" size={13} color="#ff9900" />
            <Text style={s.apiWarningText}> health data sent to Claude API to generate this summary</Text>
          </View>

          {summaryLoading ? (
            <View style={s.summaryLoading}>
              <Text style={s.dimText}>generating summary...</Text>
            </View>
          ) : (
            <ScrollView
              style={s.summaryScroll}
              contentContainerStyle={s.summaryContent}
              showsVerticalScrollIndicator={true}>
              <Text style={s.summaryTextStyle}>{cleanSummary(summaryText)}</Text>
            </ScrollView>
          )}

          {!summaryLoading && summaryText !== '' && (
            <TouchableOpacity onPress={onShare} style={s.shareBtn}>
              <Ionicons name="share-outline" size={15} color="#00ff00" />
              <Text style={s.shareBtnText}> share / export</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  modal: { flex: 1, backgroundColor: '#070707', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontFamily: FONT, fontSize: 15, color: '#00ff00' },
  modalClose: { fontFamily: FONT, fontSize: 13, color: '#444' },
  modalLabel: { fontFamily: FONT, fontSize: 10, color: '#444', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  modalInput: { fontFamily: FONT, fontSize: 13, color: '#aaa', borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 },
  modalTextArea: { fontFamily: FONT, fontSize: 12, color: '#aaa', borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, minHeight: 200, textAlignVertical: 'top' },
  modalSaveBtn: { backgroundColor: '#001a00', borderWidth: 1, borderColor: '#00ff00', borderRadius: 4, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  modalSaveText: { fontFamily: FONT, fontSize: 13, color: '#00ff00' },
  medHint: { fontFamily: FONT, fontSize: 10, color: '#888', lineHeight: 16, marginBottom: 4 },
  urgentBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#1a0000', borderWidth: 1, borderColor: '#440000', borderRadius: 4, padding: 12, marginBottom: 16 },
  urgentText: { fontFamily: FONT, fontSize: 12, color: '#ff4444', flex: 1, lineHeight: 18 },
  confirmCard: { borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 6, padding: 14, gap: 10, marginBottom: 12 },
  confirmRow: { flexDirection: 'row', gap: 12 },
  confirmLabel: { fontFamily: FONT, fontSize: 10, color: '#333', letterSpacing: 1, textTransform: 'uppercase', width: 64, paddingTop: 2 },
  confirmValue: { fontFamily: FONT, fontSize: 12, color: '#888', flex: 1, lineHeight: 18 },
  typeBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  typeBadgeText: { fontFamily: FONT, fontSize: 11, fontWeight: '600' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#111', borderRadius: 4 },
  tagText: { fontFamily: FONT, fontSize: 9, color: '#444', letterSpacing: 1 },
  privacyNote: { fontFamily: FONT, fontSize: 10, color: '#888', textAlign: 'center', marginBottom: 4, letterSpacing: 1 },
  apiWarning: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0d0800', borderWidth: 1, borderColor: '#2a1800', borderRadius: 4, padding: 10, marginBottom: 16 },
  apiWarningText: { fontFamily: FONT, fontSize: 10, color: '#ff9900', flex: 1 },
  summaryModal: { flex: 1, backgroundColor: '#070707', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 0 },
  summaryLoading: { flex: 1, alignItems: 'center', paddingTop: 40 },
  summaryScroll: { flex: 1 },
  summaryContent: { paddingBottom: 24 },
  summaryTextStyle: { fontFamily: FONT, fontSize: 14, color: '#bbb', lineHeight: 24 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  shareBtnText: { fontFamily: FONT, fontSize: 13, color: '#00ff00', letterSpacing: 1 },
  dimText: { fontFamily: FONT, fontSize: 12, color: '#888', paddingHorizontal: 20, paddingTop: 4 },
});
