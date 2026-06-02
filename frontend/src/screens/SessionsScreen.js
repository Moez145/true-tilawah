import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Header from '../components/common/Header';
import { SessionRow } from '../components/sessions/SessionRow';
import { sessionService } from '../services/sessionService';
import { useApp } from '../context/AppContext';
import { COLORS } from '../constants';

const PAGE_SIZE = 15;

export default function SessionsScreen({ navigation }) {
  const { surahs } = useApp();

  const [sessions,    setSessions]    = useState([]);
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(true);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  // Latest-call-wins guard for pagination races (e.g., user pulls-to-refresh
  // while a loadMore is in flight).
  const callIdRef = useRef(0);

  const fetchPage = useCallback(async (pageNum) => {
    const res = await sessionService.getSessions({ page: pageNum, limit: PAGE_SIZE });
    return res?.sessions || [];
  }, []);

  const loadFirstPage = useCallback(async () => {
    const myCallId = ++callIdRef.current;
    setLoading(true);
    try {
      const list = await fetchPage(1);
      if (myCallId !== callIdRef.current) return; // a newer call superseded us
      setSessions(list);
      setPage(1);
      setHasMore(list.length >= PAGE_SIZE);
    } catch (e) {
      if (myCallId !== callIdRef.current) return;
      console.warn('Sessions:loadFirstPage', e?.message);
      setSessions([]);
      setHasMore(false);
    } finally {
      if (myCallId === callIdRef.current) setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const list = await fetchPage(next);
      setSessions((prev) => [...prev, ...list]);
      setPage(next);
      setHasMore(list.length >= PAGE_SIZE);
    } catch (e) {
      console.warn('Sessions:loadMore', e?.message);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [page, loading, loadingMore, hasMore, fetchPage]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFirstPage();
    setRefreshing(false);
  }, [loadFirstPage]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  const renderItem = ({ item }) => (
    <SessionRow
      session={item}
      surahs={surahs}
      onPress={() => navigation.navigate('SessionDetail', { sessionId: item.id, session: item })}
    />
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={s.footer}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={s.empty}>
        <Text style={s.emptyTitle}>No sessions yet</Text>
        <Text style={s.emptySub}>Tap the mic on Recite or Retain to start your first recitation.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="All Sessions" onBack={() => navigation.goBack()} showSearch={false} />
      {loading && sessions.length === 0 ? (
        <View style={s.loader}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: COLORS.white },
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:        { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  footer:      { paddingVertical: 16, alignItems: 'center' },
  empty:       { paddingTop: 80, paddingHorizontal: 24, alignItems: 'center', gap: 6 },
  emptyTitle:  { fontSize: 15, fontWeight: '800', color: COLORS.primary },
  emptySub:    { fontSize: 12, color: COLORS.gray500, textAlign: 'center', lineHeight: 18 },
});
