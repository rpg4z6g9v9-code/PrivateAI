/**
 * KnowledgeBaseModal — Paste text/notes into a persona's knowledge base.
 * Extracted from app/(tabs)/index.tsx.
 */

import React from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FONT } from '@/components/chat/types';

export interface KnowledgeBaseModalProps {
  visible: boolean;
  title: string;
  content: string;
  error: string;
  personaLabel: string;
  onTitleChange: (text: string) => void;
  onContentChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export default function KnowledgeBaseModal(props: KnowledgeBaseModalProps) {
  const {
    visible, title, content, error, personaLabel,
    onTitleChange, onContentChange, onSave, onClose,
  } = props;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View style={s.modal}>
        <View style={s.header}>
          <Text style={s.title}>add to knowledge base</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={s.close}>[cancel]</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.label}>title</Text>
        <TextInput
          style={s.input}
          value={title}
          onChangeText={onTitleChange}
          placeholder="e.g. Clean Code, Chapter 3"
          placeholderTextColor="#333"
          autoCapitalize="words"
        />
        <Text style={s.label}>content</Text>
        <TextInput
          style={[s.input, s.textArea]}
          value={content}
          onChangeText={onContentChange}
          placeholder="Paste text, notes, or book excerpts here..."
          placeholderTextColor="#333"
          multiline
          textAlignVertical="top"
          autoCapitalize="sentences"
        />
        {error !== '' && (
          <Text style={s.error}>{error}</Text>
        )}
        <TouchableOpacity onPress={onSave} style={s.saveBtn}>
          <Text style={s.saveText}>save to {personaLabel}'s knowledge base</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modal: { flex: 1, backgroundColor: '#070707', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontFamily: FONT, fontSize: 15, color: '#00ff00' },
  close: { fontFamily: FONT, fontSize: 13, color: '#444' },
  label: { fontFamily: FONT, fontSize: 10, color: '#444', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  input: { fontFamily: FONT, fontSize: 13, color: '#aaa', borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 },
  textArea: { fontFamily: FONT, fontSize: 12, color: '#aaa', minHeight: 200, textAlignVertical: 'top' },
  error: { fontFamily: FONT, fontSize: 11, color: '#ff4444', marginBottom: 12 },
  saveBtn: { backgroundColor: '#001a00', borderWidth: 1, borderColor: '#00ff00', borderRadius: 4, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  saveText: { fontFamily: FONT, fontSize: 13, color: '#00ff00' },
});
